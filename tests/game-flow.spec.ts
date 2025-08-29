import { test, expect } from '@playwright/test';

test('should load the start screen and start the game', async ({ page }) => {
  // Navigate to the homepage.
  await page.goto('/');

  // Check that the start screen title is visible.
  await expect(page.getByRole('heading', { name: 'Paper Drift: Gravity Flip' })).toBeVisible();

  // Click the "Start Game" button.
  await page.getByRole('button', { name: 'Start Game' }).click();

  // Check that the game canvas is now visible.
  await expect(page.locator('canvas')).toBeVisible();

  // Check that the HUD is visible with the initial score.
  await expect(page.getByText('Score: 0')).toBeVisible();
});
