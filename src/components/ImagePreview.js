/**
 * Full-screen preview of a generated image, for when the platform refuses to
 * take it any other way.
 *
 * Not every browser implements Web Share Level 2 (sharing *files*, as opposed
 * to text and links), and some that expose navigator.clipboard still refuse to
 * write images to it.
 *
 * The Compartilhar button here gets one more go at the share sheet, and it is
 * the attempt most likely to succeed: the click is a fresh user activation and
 * the image is already made, so nothing sits between the tap and the call —
 * unlike the first attempt, which had to redraw the DOM first. If the platform
 * still says no, the image is on the page and a long press reaches the
 * browser's own share and save menu, which knows how to get to WhatsApp.
 *
 * Security note: innerHTML is used only with static markup; the image arrives
 * as an object URL, assigned through the src property.
 */

const ICON_CLOSE = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

/**
 * Show the image and the ways out of it.
 *
 * @param {HTMLElement} container
 * @param {Blob} blob
 * @param {object} options
 * @param {string} options.filename - used by the download action
 * @param {function} [options.onShare] - resolves 'shared'|'cancelled'|'unsupported'
 * @param {function} [options.onCopy] - returns a Promise<boolean>; hidden when absent
 * @param {function} [options.onClose]
 * @returns {{ destroy: function }}
 */
export function showImagePreview(container, blob, { filename, onShare, onCopy, onClose } = {}) {
  const url = URL.createObjectURL(blob);

  const overlay = document.createElement('div');
  overlay.className = 'image-preview';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Print da conversa');

  overlay.innerHTML = `
    <div class="image-preview-bar">
      <button class="image-preview-close" aria-label="Fechar">${ICON_CLOSE}</button>
      <span class="image-preview-title">Print da conversa</span>
    </div>
    <div class="image-preview-body">
      <img class="image-preview-img" alt="Print da conversa" />
      <p class="image-preview-hint"></p>
    </div>
    <div class="image-preview-actions"></div>
  `;

  overlay.querySelector('.image-preview-img').src = url;

  const actions = overlay.querySelector('.image-preview-actions');

  function addAction(label, handler, variant = '') {
    const btn = document.createElement('button');
    btn.className = `image-preview-action ${variant}`.trim();
    btn.textContent = label;
    btn.addEventListener('click', handler);
    actions.appendChild(btn);
    return btn;
  }

  const hint = overlay.querySelector('.image-preview-hint');
  hint.textContent = onShare
    ? 'Ou toque e segure na imagem para usar o menu do navegador.'
    : 'Toque e segure na imagem para compartilhar ou salvar.';

  // The second attempt at the share sheet, from a fresh click.
  if (onShare) {
    const shareBtn = addAction('Compartilhar', async () => {
      shareBtn.disabled = true;
      const result = await onShare();
      shareBtn.disabled = false;

      if (result === 'shared') { close(); return; }
      if (result === 'cancelled') return;

      // The platform refused. Say so once and leave the long press as the way
      // out, rather than offering a button that does nothing.
      shareBtn.remove();
      hint.textContent = 'Seu navegador não compartilha imagens. '
        + 'Toque e segure na imagem para usar o menu do sistema.';
    }, 'primary');
  }

  // Offered only where the clipboard actually took the image before.
  if (onCopy) {
    const copyBtn = addAction('Copiar', async () => {
      copyBtn.disabled = true;
      const ok = await onCopy();
      copyBtn.textContent = ok ? 'Copiado' : 'Não foi possível copiar';
      setTimeout(() => {
        copyBtn.textContent = 'Copiar';
        copyBtn.disabled = false;
      }, 2000);
    });
  }

  addAction('Baixar', () => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, onShare ? '' : 'primary');

  function destroy() {
    document.removeEventListener('keydown', onKeydown, true);
    overlay.remove();
    URL.revokeObjectURL(url);
  }

  function close() {
    destroy();
    if (onClose) onClose();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }

  overlay.querySelector('.image-preview-close').addEventListener('click', close);
  // Tapping the backdrop closes; tapping the image must not, or a long press
  // that starts with a tap would dismiss the thing being shared.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKeydown, true);

  container.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  return { element: overlay, destroy };
}
