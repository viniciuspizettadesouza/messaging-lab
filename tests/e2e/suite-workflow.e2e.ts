import { expect, test } from '@playwright/test';

test('creates a persistent suite and displays aggregate results', async ({
  page,
}) => {
  const suiteName = `Playwright suite ${Date.now()}`;
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Configure workloads' }),
  ).toBeVisible();
  await expect(page.getByText('healthy', { exact: true })).toHaveCount(3);

  await page.getByLabel('Messages').fill('20');
  await page.getByLabel('Payload (bytes)').fill('64');
  await page.getByLabel('Repetitions').fill('3');
  await page.getByLabel('Cooldown (ms)').fill('0');
  await page.getByLabel('Suite name', { exact: true }).fill(suiteName);

  const combinations = page.getByRole('group', {
    name: 'Broker and scenario combinations',
  });
  const combinationCheckboxes = combinations.getByRole('checkbox');
  await expect(combinationCheckboxes).toHaveCount(6);
  await expect(combinationCheckboxes.first()).toHaveAccessibleName(
    'Redis · Live fan-out',
  );
  for (let index = 1; index < 6; index += 1) {
    await combinationCheckboxes.nth(index).uncheck();
  }

  await expect(page.getByText('3 generated runs (maximum 100)')).toBeVisible();
  await page.getByRole('button', { name: 'Start benchmark suite' }).click();

  await expect(page).toHaveURL(/\?suite=[0-9a-f-]+$/i);
  const detail = page.getByRole('region', { name: suiteName });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('progressbar')).toHaveAttribute(
    'aria-valuetext',
    '3 of 3 runs finished',
    { timeout: 90_000 },
  );
  await expect(detail.locator('.run-detail-header .status-badge')).toHaveText(
    'Completed',
  );

  const aggregate = detail.getByRole('article', {
    name: 'Redis · Live fan-out trial summary',
  });
  await expect(aggregate).toContainText('3 successful · 0 unsuccessful');
  await expect(aggregate).toContainText('Throughput');
  await expect(aggregate.getByText('Lost', { exact: true })).toBeVisible();
  await expect(detail.getByRole('listitem')).toHaveCount(3);
});
