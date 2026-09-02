// @vitest-environment jsdom
//
// The drawing needs a real browser and lives in the E2E suite. What matters
// here is the delivery chain — which platform API gets the image, and what
// happens when one is missing, refuses, or refuses *because the tap that
// started everything has expired*.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const canvasStub = {
  toBlob: (cb) => cb(new Blob(['png'], { type: 'image/png' })),
};
const html2canvas = vi.fn(async () => canvasStub);
vi.mock('html2canvas', () => ({ default: (...args) => html2canvas(...args) }));

const {
  shareChatScreenshot,
  prepareScreenshot,
  clearPreparedScreenshot,
  clearPendingScreenshot,
  screenshotFilename,
  canShareFiles,
  hasSecureContext,
} = await import('../../src/lib/screenshot.js');

const element = () => document.createElement('div');

/** Errors the platform raises when the activation has run out. */
const spentActivation = () => Object.assign(new Error('spent'), { name: 'NotAllowedError' });

describe('screenshotFilename()', () => {
  it('builds a name from the contact', () => {
    expect(screenshotFilename('Ciro Soares')).toBe('masterwhats-ciro-soares.png');
  });

  it('strips accents and punctuation', () => {
    expect(screenshotFilename('Alexandre de Moraes BRASILIA'))
      .toBe('masterwhats-alexandre-de-moraes-brasilia.png');
    expect(screenshotFilename('Luiz Rennó')).toBe('masterwhats-luiz-renno.png');
    expect(screenshotFilename('DV (autoenvio)')).toBe('masterwhats-dv-autoenvio.png');
  });

  it('falls back when there is no usable name', () => {
    expect(screenshotFilename('')).toBe('masterwhats-conversa.png');
    expect(screenshotFilename('!!!')).toBe('masterwhats-conversa.png');
    expect(screenshotFilename(undefined)).toBe('masterwhats-conversa.png');
  });
});

describe('delivery', () => {
  let clickSpy;

  beforeEach(() => {
    clearPreparedScreenshot();
    clearPendingScreenshot();
    html2canvas.mockClear();
    globalThis.ClipboardItem = class { constructor(data) { this.data = data; } };
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    navigator.share = undefined;
    navigator.canShare = undefined;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });

  afterEach(() => vi.restoreAllMocks());

  const enableShare = (impl) => {
    navigator.canShare = vi.fn(() => true);
    navigator.share = vi.fn(impl);
  };
  const enableClipboard = (write) =>
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });

  it('prefers the native share sheet', async () => {
    enableShare(() => Promise.resolve());
    enableClipboard(vi.fn());

    expect((await shareChatScreenshot(element(), 'Ciro')).outcome).toBe('shared');
    expect(navigator.clipboard.write).not.toHaveBeenCalled();
  });

  it('treats a dismissed share sheet as a decision, not a failure', async () => {
    enableShare(() => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })));
    enableClipboard(vi.fn());

    expect((await shareChatScreenshot(element(), 'Ciro')).outcome).toBe('cancelled');
    expect(navigator.clipboard.write).not.toHaveBeenCalled();
  });

  // The bug this whole design exists for: redrawing the DOM outlives the tap,
  // so share() is refused and the image would otherwise land in a download the
  // user never asked for.
  it('holds the image and asks for another tap when the activation expired', async () => {
    enableShare(() => Promise.reject(spentActivation()));
    enableClipboard(vi.fn());

    const result = await shareChatScreenshot(element(), 'Ciro');

    expect(result.outcome).toBe('retry');
    expect(navigator.clipboard.write).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('shares the held image on the next tap without capturing again', async () => {
    enableShare(() => Promise.reject(spentActivation()));
    await shareChatScreenshot(element(), 'Ciro');
    const capturesSoFar = html2canvas.mock.calls.length;

    enableShare(() => Promise.resolve());
    expect((await shareChatScreenshot(element(), 'Ciro')).outcome).toBe('shared');
    expect(html2canvas).toHaveBeenCalledTimes(capturesSoFar);
  });

  it('does not reuse an image held for a different conversation', async () => {
    enableShare(() => Promise.reject(spentActivation()));
    await shareChatScreenshot(element(), 'Ciro');
    const capturesSoFar = html2canvas.mock.calls.length;

    enableShare(() => Promise.resolve());
    await shareChatScreenshot(element(), 'Martha Graeff');

    expect(html2canvas.mock.calls.length).toBeGreaterThan(capturesSoFar);
  });

  it('falls back to the clipboard when sharing fails for another reason', async () => {
    enableShare(() => Promise.reject(new Error('boom')));
    enableClipboard(vi.fn(() => Promise.resolve()));

    expect((await shareChatScreenshot(element(), 'Ciro')).outcome).toBe('copied');
  });

  // The clipboard accepts a promise, so write() is reached while the tap is
  // still live and the browser waits on the capture itself.
  it('hands the clipboard a promise rather than an awaited blob', async () => {
    const write = vi.fn(() => Promise.resolve());
    enableClipboard(write);

    expect((await shareChatScreenshot(element(), 'Ciro')).outcome).toBe('copied');

    const [[item]] = write.mock.calls[0];
    expect(typeof item.data['image/png'].then).toBe('function');
  });

  it('downloads when there is no share sheet and no clipboard', async () => {
    expect((await shareChatScreenshot(element(), 'Ciro')).outcome).toBe('downloaded');
    expect(clickSpy).toHaveBeenCalled();
  });

  it('downloads when the clipboard refuses', async () => {
    enableClipboard(vi.fn(() => Promise.reject(new Error('NotAllowedError'))));

    expect((await shareChatScreenshot(element(), 'Ciro')).outcome).toBe('downloaded');
    expect(clickSpy).toHaveBeenCalled();
  });

  it('reports a capture that never produced an image', async () => {
    html2canvas.mockImplementationOnce(() => Promise.reject(new Error('canvas morreu')));
    enableShare(() => Promise.resolve());

    const result = await shareChatScreenshot(element(), 'Ciro');

    expect(result.outcome).toBe('failed');
    expect(result.reason).toContain('canvas');
  });
});

describe('preparing ahead of the tap', () => {
  beforeEach(() => {
    clearPreparedScreenshot();
    clearPendingScreenshot();
    html2canvas.mockClear();
    navigator.canShare = vi.fn(() => true);
    navigator.share = vi.fn(() => Promise.resolve());
  });
  afterEach(() => vi.restoreAllMocks());

  it('captures when the menu opens', async () => {
    prepareScreenshot(element(), 'Ciro');
    await new Promise(r => setTimeout(r, 0));

    expect(html2canvas).toHaveBeenCalledTimes(1);
  });

  it('reuses that capture on the tap instead of making another', async () => {
    prepareScreenshot(element(), 'Ciro');
    await new Promise(r => setTimeout(r, 0));

    expect((await shareChatScreenshot(element(), 'Ciro')).outcome).toBe('shared');
    expect(html2canvas).toHaveBeenCalledTimes(1);
  });

  it('ignores a capture prepared for a different conversation', async () => {
    prepareScreenshot(element(), 'Ciro');
    await new Promise(r => setTimeout(r, 0));

    await shareChatScreenshot(element(), 'Martha Graeff');

    expect(html2canvas).toHaveBeenCalledTimes(2);
  });

  it('recaptures after the prepared image is dropped', async () => {
    prepareScreenshot(element(), 'Ciro');
    await new Promise(r => setTimeout(r, 0));
    clearPreparedScreenshot();

    await shareChatScreenshot(element(), 'Ciro');

    expect(html2canvas).toHaveBeenCalledTimes(2);
  });

  it('still delivers when the prepared capture failed', async () => {
    html2canvas.mockImplementationOnce(() => Promise.reject(new Error('falhou')));
    prepareScreenshot(element(), 'Ciro');
    await new Promise(r => setTimeout(r, 0));

    expect((await shareChatScreenshot(element(), 'Ciro')).outcome).toBe('shared');
  });
});

describe('what gets drawn', () => {
  beforeEach(() => {
    clearPreparedScreenshot();
    clearPendingScreenshot();
    html2canvas.mockClear();
    navigator.canShare = vi.fn(() => true);
    navigator.share = vi.fn(() => Promise.resolve());
  });
  afterEach(() => vi.restoreAllMocks());

  // The dropdown that asked for the print sits inside the captured area, and
  // the capture now starts while it is still open.
  it('leaves the dropdown out of the picture', async () => {
    await shareChatScreenshot(element(), 'Ciro');

    const [, options] = html2canvas.mock.calls[0];
    const menu = document.createElement('div');
    menu.className = 'chat-dropdown-menu';
    const bubble = document.createElement('div');
    bubble.className = 'chat-msg-bubble';

    expect(options.ignoreElements(menu)).toBe(true);
    expect(options.ignoreElements(bubble)).toBeFalsy();
  });

  it('draws the element box, not its full scroll height', async () => {
    const el = element();
    el.getBoundingClientRect = () => ({ width: 400, height: 800 });

    await shareChatScreenshot(el, 'Ciro');

    const [, options] = html2canvas.mock.calls[0];
    expect(options.width).toBe(400);
    expect(options.height).toBe(800);
    expect(options.scrollX).toBe(0);
    expect(options.scrollY).toBe(0);
  });

  it('caps the pixel ratio so a 3x screen does not triple the file', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });

    await shareChatScreenshot(element(), 'Ciro');

    expect(html2canvas.mock.calls[0][1].scale).toBe(2);
  });
});

describe('capability probes', () => {
  afterEach(() => vi.restoreAllMocks());

  it('canShareFiles is false without the API', () => {
    navigator.share = undefined;
    navigator.canShare = undefined;
    expect(canShareFiles()).toBe(false);
  });

  it('canShareFiles asks the browser about a png', () => {
    navigator.share = vi.fn();
    navigator.canShare = vi.fn(() => true);

    expect(canShareFiles()).toBe(true);
    const [{ files }] = navigator.canShare.mock.calls[0];
    expect(files[0].type).toBe('image/png');
  });

  it('hasSecureContext reports what the browser says', () => {
    expect(typeof hasSecureContext()).toBe('boolean');
  });
});

describe('capabilityReport()', () => {
  afterEach(() => vi.restoreAllMocks());

  it('names every capability the delivery depends on', async () => {
    const { capabilityReport } = await import('../../src/lib/screenshot.js');

    for (const key of ['sec', 'shr', 'csf', 'clip', 'ci']) {
      expect(capabilityReport()).toContain(`${key}=`);
    }
  });

  it('reports each capability as present or absent', async () => {
    const { capabilityReport } = await import('../../src/lib/screenshot.js');
    navigator.share = undefined;
    navigator.canShare = undefined;

    expect(capabilityReport()).toContain('shr=0');
    expect(capabilityReport()).toContain('csf=0');
  });
});
