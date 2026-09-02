/**
 * Capture the open chat as an image and hand it to the platform.
 *
 * Browsers have no screenshot API without a permission prompt, so the picture
 * is redrawn from the DOM by html2canvas rather than grabbed from the screen.
 * What you get is what is on screen right now: the main area is viewport-sized,
 * and the scrolled message list is clipped by its own box.
 *
 * Where the image goes depends on what the platform offers:
 *   1. the native share sheet, when the device has one that accepts files
 *   2. the clipboard
 *   3. a download, as a last resort
 *
 * The first two need a secure context (https, or localhost). Served over plain
 * http — a LAN or tailnet address, say — neither API exists and every capture
 * falls through to the download.
 */

/** Loaded on demand: ~50 kB that only matters once someone asks for a print. */
async function loadHtml2Canvas() {
  const { default: html2canvas } = await import('html2canvas');
  return html2canvas;
}

/** True when the browser exposes the APIs that need https. */
export function hasSecureContext() {
  return typeof window !== 'undefined' && window.isSecureContext === true;
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

/**
 * Offer a blob to the platform.
 *
 * @param {Blob} blob
 * @param {string} filename
 * @returns {Promise<'shared'|'copied'|'downloaded'|'cancelled'>} what happened,
 *   so the caller knows whether a toast is still worth showing.
 */
export async function deliverImage(blob, filename) {
  const file = new File([blob], filename, { type: 'image/png' });

  // 1. Native share sheet. Its own UI is the confirmation, so a toast after it
  //    would be noise.
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      // The user dismissing the sheet is not a failure; anything else falls
      // through to the clipboard.
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }

  // 2. Clipboard.
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'copied';
    } catch {
      // Denied or unsupported for images — fall through.
    }
  }

  // 3. Download.
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

/** A filename that says which conversation the image came from. */
export function screenshotFilename(conversationName) {
  const slug = (conversationName || 'conversa')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `masterwhats-${slug || 'conversa'}.png`;
}

/**
 * Capture a chat and deliver it.
 *
 * @param {HTMLElement} element - the area to capture
 * @param {string} conversationName - used for the filename
 * @returns {Promise<'shared'|'copied'|'downloaded'|'cancelled'>}
 */
export async function shareChatScreenshot(element, conversationName) {
  const blob = await captureElement(element);
  return deliverImage(blob, screenshotFilename(conversationName));
}
