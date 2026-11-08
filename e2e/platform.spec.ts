import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { probeUrl } from './paths.ts';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
) as { version: string };

async function openApp(page: Page) {
  await page.goto(probeUrl);
  await expect(page.getByRole('heading', { level: 1, name: 'Plattform' })).toBeVisible();
}

test('loads over file:// without console errors and shows title and version', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));

  await openApp(page);
  await expect(page.getByText(version, { exact: true })).toBeVisible();
  expect(problems).toEqual([]);
});

test('lists ArrowDown, Enter and Escape with their mapping, newest first', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  const items = page.getByTestId('key-list').getByRole('listitem');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText('Escape');
  await expect(items.nth(0)).toContainText('back');
  await expect(items.nth(1)).toContainText('Enter');
  await expect(items.nth(1)).toContainText('enter');
  await expect(items.nth(2)).toContainText('ArrowDown');
  await expect(items.nth(2)).toContainText('down');
});

test('Escape does not navigate', async ({ page }) => {
  await openApp(page);
  const before = page.url();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('key-list').getByRole('listitem')).toHaveCount(1);
  expect(page.url()).toBe(before);
});
