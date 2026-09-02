// @vitest-environment jsdom
//
// The capture itself needs a real browser and lives in the E2E suite. What is
// worth pinning here is the delivery chain: which platform API gets the image,
// and what happens when each one is missing or refuses.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deliverImage, screenshotFilename, hasSecureContext } from '../../src/lib/screenshot.js';

const blob = () => new Blob(['x'], { type: 'image/png' });

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

describe('deliverImage()', () => {
  let originalShare, originalCanShare, originalClipboard;

  beforeEach(() => {
    originalShare = navigator.share;
    originalCanShare = navigator.canShare;
    originalClipboard = navigator.clipboard;
    globalThis.ClipboardItem = class { constructor(data) { this.data = data; } };
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    navigator.share = originalShare;
    navigator.canShare = originalCanShare;
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
    vi.restoreAllMocks();
  });

  const setClipboard = (write) =>
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });

  it('prefers the native share sheet when it takes files', async () => {
    navigator.canShare = vi.fn(() => true);
    navigator.share = vi.fn(() => Promise.resolve());
    setClipboard(vi.fn());

    expect(await deliverImage(blob(), 'a.png')).toBe('shared');
    expect(navigator.share).toHaveBeenCalled();
    expect(navigator.clipboard.write).not.toHaveBeenCalled();
  });

  // Dismissing the sheet is a decision, not a failure — copying anyway would
  // put something on the clipboard the user did not ask for.
  it('stops when the user dismisses the share sheet', async () => {
    navigator.canShare = vi.fn(() => true);
    navigator.share = vi.fn(() => Promise.reject(
      Object.assign(new Error('cancelled'), { name: 'AbortError' })
    ));
    setClipboard(vi.fn());

    expect(await deliverImage(blob(), 'a.png')).toBe('cancelled');
    expect(navigator.clipboard.write).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard when sharing actually fails', async () => {
    navigator.canShare = vi.fn(() => true);
    navigator.share = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    setClipboard(vi.fn(() => Promise.resolve()));

    expect(await deliverImage(blob(), 'a.png')).toBe('copied');
  });

  it('copies when there is no share sheet', async () => {
    navigator.canShare = undefined;
    navigator.share = undefined;
    setClipboard(vi.fn(() => Promise.resolve()));

    expect(await deliverImage(blob(), 'a.png')).toBe('copied');
  });

  it('copies when the share sheet refuses files', async () => {
    navigator.canShare = vi.fn(() => false);
    navigator.share = vi.fn();
    setClipboard(vi.fn(() => Promise.resolve()));

    expect(await deliverImage(blob(), 'a.png')).toBe('copied');
    expect(navigator.share).not.toHaveBeenCalled();
  });

  // Plain http — a LAN or tailnet address — exposes neither API.
  it('downloads when neither API exists', async () => {
    navigator.canShare = undefined;
    navigator.share = undefined;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    expect(await deliverImage(blob(), 'conversa.png')).toBe('downloaded');
    expect(click).toHaveBeenCalled();
  });

  it('downloads when the clipboard rejects the image', async () => {
    navigator.canShare = undefined;
    navigator.share = undefined;
    setClipboard(vi.fn(() => Promise.reject(new Error('NotAllowedError'))));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    expect(await deliverImage(blob(), 'conversa.png')).toBe('downloaded');
    expect(click).toHaveBeenCalled();
  });

  it('cleans up the object URL it created for the download', async () => {
    navigator.canShare = undefined;
    navigator.share = undefined;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.useFakeTimers();

    await deliverImage(blob(), 'conversa.png');
    vi.advanceTimersByTime(1500);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    vi.useRealTimers();
  });
});

describe('hasSecureContext()', () => {
  it('reports what the browser says', () => {
    expect(typeof hasSecureContext()).toBe('boolean');
  });
});
