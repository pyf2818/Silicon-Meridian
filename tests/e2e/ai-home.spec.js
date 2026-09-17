import { expect, test } from '@playwright/test';
import { installExternalFixtures } from './fixtures.js';

test('opens the AI workstation and reaches the daily briefing from the primary path', async ({ page }) => {
  await installExternalFixtures(page);
  await page.goto('/');
  const onboarding = page.getByRole('dialog', { name: '新用户引导' });
  if (await onboarding.isVisible().catch(() => false)) {
    await onboarding.getByRole('button', { name: '跳过引导' }).click();
  }
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('body')).toContainText(/AI|GitHub|智能|情报|工作/);
  await expect(page.getByText('今日速报').first()).toBeVisible({ timeout: 15_000 });
  await page.getByText('今日速报').first().click();
  await expect(page.getByText('OpenAI releases a new agent platform today').or(page.getByText('OpenAI releases new Agent platform')).first()).toBeVisible({ timeout: 15_000 });
});
