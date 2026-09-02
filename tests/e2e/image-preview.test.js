import { test, expect } from '@playwright/test';

// Some browsers share text but refuse files (Web Share Level 2), and some
// expose navigator.clipboard yet reject images. On those the print has nowhere
// to go, so it goes on screen instead — where the platform's own long-press
// menu can share it. This pins that path down by making the page report the
// same capabilities.

const clipShimRefusesImages = () => {
  // The profile Rafael's phone reports: share exists and takes text, canShare
  // says no to files, and the clipboard refuses images.
  navigator.share = () => Promise.reject(
    Object.assign(new Error('refused'), { name: 'NotAllowedError' })
  );
  navigator.canShare = () => false;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      write: () => Promise.reject(
        Object.assign(new Error('refused'), { name: 'NotAllowedError' })
      ),
    },
  });
};

async function openPrint(page) {
  await page.goto('/#/chat/ciro-soares');
  await expect(page.locator('.chat-msg-bubble').first()).toBeVisible();
  await page.evaluate(clipShimRefusesImages);
  await page.locator('.chat-header button[aria-label="Menu"]').click();
  await page.locator('.chat-dropdown-item', { hasText: 'Compartilhar print' }).click();
}

test.describe('Image preview fallback', () => {
  test('opens when neither sharing nor copying is possible', async ({ page }) => {
    await openPrint(page);

    await expect(page.locator('.image-preview')).toBeVisible({ timeout: 20000 });
    // The wording differs depending on whether a share button is offered; both
    // point at the long press, which is the guaranteed way out.
    await expect(page.locator('.image-preview-hint'))
      .toContainText('toque e segure', { ignoreCase: true });
  });

  test('shows the captured image, loaded', async ({ page }) => {
    await openPrint(page);

    const img = page.locator('.image-preview-img');
    await expect(img).toBeVisible({ timeout: 20000 });
    expect(await img.evaluate(el => el.naturalWidth)).toBeGreaterThan(0);
  });

  test('offers sharing, copying and downloading', async ({ page }) => {
    await openPrint(page);
    await expect(page.locator('.image-preview')).toBeVisible({ timeout: 20000 });

    const labels = await page.locator('.image-preview-action').allTextContents();
    expect(labels).toEqual(['Compartilhar', 'Copiar', 'Baixar']);
  });

  // The click is a fresh activation and the image is already made, so this is
  // the platform's best shot at the share sheet.
  test('the share button reaches the share sheet with the image', async ({ page }) => {
    await page.goto('/#/chat/ciro-soares');
    await expect(page.locator('.chat-msg-bubble').first()).toBeVisible();
    await page.evaluate(() => {
      window.__shared = null;
      navigator.canShare = () => false;              // refuses the probe
      navigator.share = (data) => {                  // but takes the real call
        window.__shared = (data.files || []).map(f => ({ name: f.name, type: f.type }));
        return Promise.resolve();
      };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { write: () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })) },
      });
    });
    await page.locator('.chat-header button[aria-label="Menu"]').click();
    await page.locator('.chat-dropdown-item', { hasText: 'Compartilhar print' }).click();
    await expect(page.locator('.image-preview')).toBeVisible({ timeout: 20000 });

    await page.locator('.image-preview-action', { hasText: 'Compartilhar' }).click();

    await expect.poll(() => page.evaluate(() => window.__shared)).not.toBeNull();
    const shared = await page.evaluate(() => window.__shared);
    expect(shared[0].type).toBe('image/png');
    // Sharing succeeded, so the overlay has done its job and gets out of the way.
    await expect(page.locator('.image-preview')).toHaveCount(0);
  });

  test('says so and keeps the long press when the platform refuses', async ({ page }) => {
    await page.goto('/#/chat/ciro-soares');
    await expect(page.locator('.chat-msg-bubble').first()).toBeVisible();
    await page.evaluate(() => {
      navigator.canShare = () => false;
      navigator.share = () => Promise.reject(
        Object.assign(new Error('no'), { name: 'NotAllowedError' })
      );
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { write: () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })) },
      });
    });
    await page.locator('.chat-header button[aria-label="Menu"]').click();
    await page.locator('.chat-dropdown-item', { hasText: 'Compartilhar print' }).click();
    await expect(page.locator('.image-preview')).toBeVisible({ timeout: 20000 });

    await page.locator('.image-preview-action', { hasText: 'Compartilhar' }).click();

    await expect(page.locator('.image-preview-hint')).toContainText('não compartilha imagens');
    await expect(page.locator('.image-preview-action', { hasText: 'Compartilhar' })).toHaveCount(0);
    await expect(page.locator('.image-preview-img')).toBeVisible();
  });

  test('says so when the clipboard refuses again', async ({ page }) => {
    await openPrint(page);
    await expect(page.locator('.image-preview')).toBeVisible({ timeout: 20000 });

    const copy = page.locator('.image-preview-action', { hasText: 'Copiar' });
    await copy.click();

    await expect(page.locator('.image-preview-action', { hasText: 'Não foi possível copiar' }))
      .toBeVisible();
  });

  test('closes on the X', async ({ page }) => {
    await openPrint(page);
    await expect(page.locator('.image-preview')).toBeVisible({ timeout: 20000 });

    await page.locator('.image-preview-close').click();

    await expect(page.locator('.image-preview')).toHaveCount(0);
  });

  test('closes on Escape', async ({ page }) => {
    await openPrint(page);
    await expect(page.locator('.image-preview')).toBeVisible({ timeout: 20000 });

    await page.keyboard.press('Escape');

    await expect(page.locator('.image-preview')).toHaveCount(0);
  });

  // A long press starts as a touch on the image; dismissing on that would make
  // the one gesture that works impossible.
  test('tapping the image does not close it', async ({ page }) => {
    await openPrint(page);
    await expect(page.locator('.image-preview-img')).toBeVisible({ timeout: 20000 });

    await page.locator('.image-preview-img').click();

    await expect(page.locator('.image-preview')).toBeVisible();
  });
});
