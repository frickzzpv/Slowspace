import { test, expect } from '@playwright/test';

test('smoke test', async ({ page }) => {
  // Navigate to the home page
  await page.goto('/');

  // The game might take a moment to load, so let's wait for the start button
  const startButton = page.getByRole('button', { name: 'Start Game' });
  await expect(startButton).toBeVisible({ timeout: 10000 }); // 10s timeout

  // Check that the start menu heading is also visible
  await expect(page.getByRole('heading', { name: 'Paper Drift' })).toBeVisible();

  // Click the start button
  await startButton.click();

  // Check that the game UI is now visible
  // After starting the game, a score display appears. Let's look for "Score: 0"
  await expect(page.getByText(/Score: \d+/)).toBeVisible();

  // Also check that the start menu is gone
  await expect(page.getByRole('heading', { name: 'Paper Drift' })).not.toBeVisible();
  await expect(startButton).not.toBeVisible();
});
