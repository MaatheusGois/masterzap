/**
 * Capture the open chat as an image and hand it to the platform.
 *
 * Browsers have no screenshot API without a permission prompt, so the picture
 * is redrawn from the DOM by html2canvas rather than grabbed from the screen.
 * What you get is what is on screen right now: the main area is viewport-sized,
 * and the scrolled message list is clipped by its own box.
 *
 * ## Why this is not a straight line
 *
 * `navigator.share` and `navigator.clipboard.write` both need *transient user
 * activation* — they must be reached while the tap that started everything is
 * still "live", a window of a few seconds. Redrawing the DOM takes long enough
 * on a phone to spend it, so the obvious shape
 *
 *     await capture(); await navigator.share(...)
 *
 * fails with NotAllowedError, silently falls through, and lands on a download.
 *
 * Two different answers, because the two APIs differ:
 *
 *   - The clipboard accepts a **Promise** inside ClipboardItem. `write()` is
 *     called immediately, while the activation is fresh, and the browser waits
 *     on the capture itself.
 *   - Sharing takes no promise. The capture is reused instead: when the share
 *     is refused for a spent activation, the image is kept and the next tap
 *     shares it straight away.
 *
 * Both APIs also require a secure context. Served over plain http neither
 * exists, and every capture falls through to a download.
 */

/** Loaded on demand: ~200 kB that only matters once someone asks for a print. */
async function loadHtml2Canvas() {
  const { default: html2canvas } = await import('html2canvas');
  return html2canvas;
}

/** True when the browser exposes the APIs that need https. */
export function hasSecureContext() {
  return typeof window !== 'undefined' && window.isSecureContext === true;
}

/**
 * Whether this platform can share image files at all.
 *
 * Probed with an empty file: canShare() only inspects the type, and asking
 * before the capture keeps the decision out of the activation window.
 */
export function canShareFiles() {
  if (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) {
    return false;
  }
  try {
    const probe = new File([], 'probe.png', { type: 'image/png' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * A one-line account of what this browser actually offers.
 *
 * There is no console on a phone, so when the delivery does not go the way it
 * should this is the only way to find out which capability is missing rather
 * than guessing at it.
 *
 *   sec  — secure context (https or localhost); without it none of the rest exists
 *   shr  — navigator.share
 *   csf  — navigator.canShare accepts a png file
 *   clip — navigator.clipboard.write
 *   ci   — the ClipboardItem constructor
 */
export function capabilityReport() {
  const yes = (v) => (v ? '1' : '0');
  return [
    `sec=${yes(typeof window !== 'undefined' && window.isSecureContext)}`,
    `shr=${yes(typeof navigator !== 'undefined' && navigator.share)}`,
    `csf=${yes(canShareFiles())}`,
    `clip=${yes(typeof navigator !== 'undefined' && navigator.clipboard?.write)}`,
    `ci=${yes(typeof ClipboardItem !== 'undefined')}`,
  ].join(' ');
}

function canUseClipboard() {
  return typeof navigator !== 'undefined'
    && !!navigator.clipboard?.write
    && typeof ClipboardItem !== 'undefined';
}

/** A refusal that is really "your tap expired", not "you may not do this". */
function isSpentActivation(err) {
  return err?.name === 'NotAllowedError' || err?.name === 'InvalidStateError';
}

/**
 * Render an element to a PNG blob, clipped to what is visible.
 * @param {HTMLElement} element
 * @returns {Promise<Blob>}
 */
export async function captureElement(element) {
  const html2canvas = await loadHtml2Canvas();
  const rect = element.getBoundingClientRect();

  const canvas = await html2canvas(element, {
    // The dropdown that started this sits inside the captured area; the picture
    // should show the conversation, not the menu used to ask for it.
    ignoreElements: el => el.classList?.contains('chat-dropdown-menu'),
    // Cap the pixel ratio: a 3x phone screen would otherwise produce an image
    // several times larger than anything needs.
    scale: Math.min(window.devicePixelRatio || 1, 2),
    backgroundColor: null,
    useCORS: true,
    logging: false,
    // Draw the element's own box, not its full scroll height.
    width: rect.width,
    height: rect.height,
    windowWidth: document.documentElement.clientWidth,
    windowHeight: document.documentElement.clientHeight,
    scrollX: 0,
    scrollY: 0,
  });

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Não foi possível gerar a imagem.');
  return blob;
}

/** A filename that says which conversation the image came from. */
export function screenshotFilename(conversationName) {
  const slug = (conversationName || 'conversa')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `masterwhats-${slug || 'conversa'}.png`;
}

/**
 * A capture started when the menu opened, so the tap that follows finds the
 * image already made and reaches navigator.share() with its activation intact.
 * That is the whole trick: redrawing the DOM takes seconds, and the tap does
 * not survive it.
 */
const PREPARED_WINDOW_MS = 15_000;
let prepared = null;

/**
 * Begin capturing ahead of the tap. Safe to call repeatedly; a failure here is
 * not surfaced, because the tap path captures again if this produced nothing.
 *
 * @param {HTMLElement} element
 * @param {string} conversationName
 */
export function prepareScreenshot(element, conversationName) {
  const filename = screenshotFilename(conversationName);
  const promise = captureElement(element).catch(() => null);
  prepared = { filename, promise, at: Date.now() };
}

async function takePrepared(filename) {
  if (!prepared) return null;
  const fresh = prepared.filename === filename
    && Date.now() - prepared.at < PREPARED_WINDOW_MS;
  const promise = fresh ? prepared.promise : null;
  prepared = null;
  return promise ? await promise : null;
}

/** Drop any capture started ahead of time (leaving a chat, closing the menu). */
export function clearPreparedScreenshot() {
  prepared = null;
}

/**
 * An image held from a tap whose activation ran out, so the retry is instant.
 * Short-lived on purpose: sharing a picture of a screen the user has already
 * scrolled away from would be worse than capturing again.
 */
const RETRY_WINDOW_MS = 30_000;
let pending = null;

function takePending(filename) {
  if (!pending) return null;
  const fresh = pending.filename === filename
    && Date.now() - pending.at < RETRY_WINDOW_MS;
  const blob = fresh ? pending.blob : null;
  pending = null;
  return blob;
}

/** Forget any held capture (exported for tests and for leaving a chat). */
export function clearPendingScreenshot() {
  pending = null;
}

/**
 * Try the clipboard with a blob already in hand.
 * @returns {Promise<boolean>} whether it took it
 */
export async function copyImageToClipboard(blob) {
  if (!canUseClipboard()) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture a chat and deliver it.
 *
 * Call this straight from the click handler and do not await anything before
 * it, or the activation both APIs depend on will already be gone.
 *
 * @param {HTMLElement} element - the area to capture
 * @param {string} conversationName - used for the filename
 * @returns {Promise<{outcome: string, reason?: string}>}
 *   outcome is one of: shared | cancelled | retry | copied | preview | failed
 *   'preview' carries { blob, filename } for the caller to put on screen
 */
export async function shareChatScreenshot(element, conversationName) {
  const filename = screenshotFilename(conversationName);
  const diag = capabilityReport();

  if (canShareFiles()) {
    // Reuse the image from a tap that lost its activation, so this one is
    // instant and the share sheet still opens.
    let blob;
    try {
      // Prefer an image already made: from the retry hold, or from the capture
      // started when the menu opened. Awaiting a settled promise costs only a
      // microtask, which the activation survives.
      blob = takePending(filename)
        || await takePrepared(filename)
        || await captureElement(element);
    } catch (err) {
      return { outcome: 'failed', reason: err?.message, diag };
    }

    try {
      await navigator.share({ files: [new File([blob], filename, { type: 'image/png' })] });
      return { outcome: 'shared', diag };
    } catch (err) {
      if (err?.name === 'AbortError') return { outcome: 'cancelled', diag };

      if (isSpentActivation(err)) {
        // The capture outlived the tap. Hold the image so the next one shares
        // immediately instead of falling back to something the user did not ask for.
        pending = { filename, blob, at: Date.now() };
        return { outcome: 'retry', reason: err?.name, diag };
      }

      if (await copyImageToClipboard(blob)) {
        return { outcome: 'copied', reason: err?.name, diag };
      }
      return { outcome: 'preview', blob, filename, reason: err?.name, diag };
    }
  }

  // No share sheet. The clipboard takes a promise, so write() runs now — while
  // the tap is still live — and the browser waits on the capture.
  if (canUseClipboard()) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': prepared?.promise?.then(b => b || captureElement(element))
          || captureElement(element) }),
      ]);
      prepared = null;
      return { outcome: 'copied', diag };
    } catch (err) {
      // Some builds reject a promise-valued ClipboardItem, and some accept the
      // call but refuse images outright. Capture once more and let the caller
      // put the picture on screen, where the platform's own long-press menu can
      // reach it.
      try {
        const blob = await captureElement(element);
        if (await copyImageToClipboard(blob)) {
          return { outcome: 'copied', diag };
        }
        return { outcome: 'preview', blob, filename, reason: err?.name, diag };
      } catch (captureErr) {
        return { outcome: 'failed', reason: captureErr?.message || err?.name, diag };
      }
    }
  }

  try {
    return { outcome: 'preview', blob: await captureElement(element), filename, diag };
  } catch (err) {
    return { outcome: 'failed', reason: err?.message, diag };
  }
}
