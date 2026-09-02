import { test, expect } from '@playwright/test';

// The capture itself only exists in a real browser: html2canvas walks the live
// DOM and paints it into a canvas. The delivery chain is unit-tested; what is
// checked here is that the button is wired, the picture comes out, and it
// frames the chat rather than the whole page.

const openChat = async (page) => {
  await page.goto('/#/chat/alexandre-de-moraes');
  await expect(page.locator('.chat-view')).toBeVisible();
  await expect(page.locator('.chat-msg-bubble').first()).toBeVisible();
};

const openMenu = (page) => page.locator('.chat-header button[aria-label="Menu"]').click();

/** Grab the PNG the app produces, whichever way it ends up delivering it. */
async function captureProducedImage(page) {
  await page.evaluate(() => {
    window.__png = null;
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const reader = new FileReader();
      reader.onload = () => { window.__png = reader.result; };
      reader.readAsDataURL(blob);
      return original(blob);
    };
    // Keep the download from actually navigating in the test browser.
    HTMLAnchorElement.prototype.click = function () {};
  });

  await openMenu(page);
  await page.locator('.chat-dropdown-item', { hasText: 'Compartilhar print' }).click();

  await expect.poll(() => page.evaluate(() => window.__png), { timeout: 20000 })
    .not.toBeNull();
  return page.evaluate(() => window.__png);
}

test.describe('Chat screenshot', () => {
  test.beforeEach(async ({ page }) => { await openChat(page); });

  test('the menu offers it', async ({ page }) => {
    await openMenu(page);

    const item = page.locator('.chat-dropdown-item', { hasText: 'Compartilhar print' });
    await expect(item).toBeVisible();
    await expect(item).not.toHaveClass(/disabled/);
  });

  test('the menu closes when it is chosen', async ({ page }) => {
    await openMenu(page);
    await page.locator('.chat-dropdown-item', { hasText: 'Compartilhar print' }).click();

    await expect(page.locator('.chat-dropdown-menu')).toBeHidden();
  });

  test('it produces a PNG', async ({ page }) => {
    const dataUrl = await captureProducedImage(page);

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(dataUrl.length).toBeGreaterThan(5000);
  });

  test('the image frames the chat, not the sidebar', async ({ page }) => {
    const dataUrl = await captureProducedImage(page);

    const size = await page.evaluate(src => new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.src = src;
    }), dataUrl);

    const area = await page.locator('.main-area').boundingBox();
    const ratio = size.width / size.height;
    const expected = area.width / area.height;

    // Rendered at devicePixelRatio, so compare shape rather than pixel counts.
    expect(Math.abs(ratio - expected)).toBeLessThan(0.05);

    // On desktop the sidebar sits outside the frame; the capture must be
    // narrower than the window.
    if (page.viewportSize().width > 600) {
      const sidebar = await page.locator('.sidebar').boundingBox();
      expect(area.width).toBeLessThan(page.viewportSize().width - sidebar.width + 1);
    }
  });

  test('it captures only what is on screen, not the whole scroll', async ({ page }) => {
    const dataUrl = await captureProducedImage(page);

    const height = await page.evaluate(src => new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img.naturalHeight);
      img.src = src;
    }), dataUrl);

    const scrollHeight = await page.locator('.chat-messages')
      .evaluate(el => el.scrollHeight);
    const dpr = await page.evaluate(() => Math.min(window.devicePixelRatio || 1, 2));

    expect(height / dpr).toBeLessThan(scrollHeight);
  });

  test('confirms with a toast when it lands on the clipboard', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only here');
    // localhost is a secure context, so the clipboard path is the live one.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await openMenu(page);
    await page.locator('.chat-dropdown-item', { hasText: 'Compartilhar print' }).click();

    await expect(page.locator('.search-toast')).toContainText(/copiada|salva/, { timeout: 20000 });
  });
});

// The clone html2canvas paints is a second, live document: it re-downloads the
// stylesheets rather than reusing the ones already parsed on the page. When
// that second request does not land, the capture comes out as raw HTML —
// serif text, no bubbles, no colours — and nothing reports a failure.
//
// The picture must not depend on the network a second time.
test.describe('Chat screenshot without the network', () => {
  /** Fraction of the image within reach of a colour, 0..1. */
  const shareOfColour = (page, dataUrl, rgb) => page.evaluate(([src, want]) =>
    new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        const { data } = canvas.getContext('2d')
          .getImageData(0, 0, canvas.width, canvas.height);
        let hits = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (Math.abs(data[i] - want[0]) < 12
            && Math.abs(data[i + 1] - want[1]) < 12
            && Math.abs(data[i + 2] - want[2]) < 12) hits++;
        }
        resolve(hits / (data.length / 4));
      };
      img.src = src;
    }), [dataUrl, rgb]);

  const OUTGOING_BUBBLE = [0xd9, 0xfd, 0xd3];

  test('keeps the styling when the stylesheets cannot be fetched again', async ({ page }) => {
    await openChat(page);
    // Everything the page needs is already parsed and on screen. From here on,
    // a stylesheet request can only be the clone asking for it a second time.
    await page.route('**/*.css', route => route.abort());

    const dataUrl = await captureProducedImage(page);

    expect(await shareOfColour(page, dataUrl, OUTGOING_BUBBLE)).toBeGreaterThan(0.02);
  });
});
