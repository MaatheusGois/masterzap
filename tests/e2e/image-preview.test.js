import { test, expect } from '@playwright/test';

// Some browsers share text but refuse files (Web Share Level 2), and some
// expose navigator.clipboard yet reject images. On those the print has nowhere
// to go, so it goes on screen instead — where the platform's own long-press
// menu can share it. This pins that path down by making the page report the
// same capabilities.

const clipShimRefusesImages = () => {
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
    await expect(page.locator('.image-preview-hint'))
      .toContainText('Toque e segure');
  });

  test('shows the captured image, loaded', async ({ page }) => {
    await openPrint(page);

    const img = page.locator('.image-preview-img');
    await expect(img).toBeVisible({ timeout: 20000 });
    expect(await img.evaluate(el => el.naturalWidth)).toBeGreaterThan(0);
  });

  test('offers copying and downloading', async ({ page }) => {
    await openPrint(page);
    await expect(page.locator('.image-preview')).toBeVisible({ timeout: 20000 });

    const labels = await page.locator('.image-preview-action').allTextContents();
    expect(labels).toEqual(['Copiar', 'Baixar']);
  });

  test('says so when the clipboard refuses again', async ({ page }) => {
    await openPrint(page);
    await expect(page.locator('.image-preview')).toBeVisible({ timeout: 20000 });

    await page.locator('.image-preview-action', { hasText: 'Copiar' }).click();

    await expect(page.locator('.image-preview-action').first())
      .toHaveText('Não foi possível copiar');
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
