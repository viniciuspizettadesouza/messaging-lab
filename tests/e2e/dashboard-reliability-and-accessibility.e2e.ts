import { readFile } from 'node:fs/promises';

import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('creates a persistent suite and displays aggregate results', async ({
  page,
}) => {
  const suiteName = uniqueName('Aggregate suite');
  await openDashboard(page);
  await configureWorkload(page, { messages: 20, payloadBytes: 64 });
  await page.getByLabel('Repetitions').fill('3');
  await page.getByLabel('Cooldown (ms)').fill('0');
  await page.getByLabel('Suite name', { exact: true }).fill(suiteName);
  await selectOnlyCombination(page, 0);

  await expect(page.getByText('3 generated runs (maximum 100)')).toBeVisible();
  await page.getByRole('button', { name: 'Start benchmark suite' }).click();

  const detail = page.getByRole('region', { name: suiteName });
  await expect(page).toHaveURL(/\?suite=[0-9a-f-]+$/i);
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
  await expect(detail.locator('.suite-trials > ol > li')).toHaveCount(3);
});

test('restores an active suite after reload and cancels it from the browser', async ({
  page,
}) => {
  const suiteName = uniqueName('Reload suite');
  await openDashboard(page);
  await configureWorkload(page, { messages: 400, consumerDelayMs: 20 });
  await page.getByLabel('Repetitions').fill('2');
  await page.getByLabel('Cooldown (ms)').fill('5000');
  await page.getByLabel('Suite name', { exact: true }).fill(suiteName);
  await selectOnlyCombination(page, 1);
  await page.getByRole('button', { name: 'Start benchmark suite' }).click();

  await expect(page).toHaveURL(/\?suite=[0-9a-f-]+$/i);
  const suiteUrl = page.url();
  const detail = page.getByRole('region', { name: suiteName });
  await expect(
    detail.getByRole('button', { name: 'Cancel suite' }),
  ).toBeVisible();
  await expect(detail.getByRole('progressbar')).toHaveAttribute(
    'aria-valuetext',
    /0 of 2 runs finished|1 of 2 runs finished/,
  );

  await page.reload();
  await expect(page).toHaveURL(suiteUrl);
  await expect(detail).toBeVisible();
  await expect(
    detail.getByRole('button', { name: 'Cancel suite' }),
  ).toBeVisible();
  await detail.getByRole('button', { name: 'Cancel suite' }).click();
  await expect(detail.locator('.run-detail-header .status-badge')).toHaveText(
    'Cancelled',
    { timeout: 30_000 },
  );
});

test('reconnects run SSE without duplicated terminal handling', async ({
  page,
}) => {
  const runName = uniqueName('Reconnect run');
  let abortedStream = false;
  let terminalDetailRequests = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'GET' &&
      /\/api\/runs\/[0-9a-f-]+$/i.test(new URL(request.url()).pathname)
    ) {
      terminalDetailRequests += 1;
    }
  });
  await page.route('**/api/runs/*/events', async (route) => {
    if (!abortedStream) {
      abortedStream = true;
      await route.abort('connectionfailed');
      await page.unroute('**/api/runs/*/events');
      return;
    }
    await route.continue();
  });

  await openDashboard(page);
  await configureWorkload(page, { messages: 300, consumerDelayMs: 20 });
  await page.getByLabel('Standalone name (optional)').fill(runName);
  await page
    .getByLabel('Standalone scenario')
    .selectOption('competing-consumers');
  await page.getByRole('button', { name: 'Start standalone run' }).click();

  const detail = page.getByRole('region', { name: runName });
  await expect(detail.getByText('Live connection lost')).toBeVisible();
  await expect(detail.getByText('Live connection lost')).toBeHidden({
    timeout: 15_000,
  });
  await expect(detail.locator('.run-detail-header .status-badge')).toHaveText(
    'Completed',
    { timeout: 30_000 },
  );
  await expect.poll(() => terminalDetailRequests).toBe(1);
  await expect(detail.locator('.run-detail-header .status-badge')).toHaveCount(
    1,
  );
});

test('cancels an active standalone run from the browser', async ({ page }) => {
  const runName = uniqueName('Cancelled run');
  await openDashboard(page);
  await configureWorkload(page, { messages: 500, consumerDelayMs: 20 });
  await page.getByLabel('Standalone name (optional)').fill(runName);
  await page
    .getByLabel('Standalone scenario')
    .selectOption('competing-consumers');
  await page.getByRole('button', { name: 'Start standalone run' }).click();

  const detail = page.getByRole('region', { name: runName });
  const progress = detail.locator('.live-progress[aria-live="polite"]');
  await expect(progress).toContainText('published');
  await expect(progress).toContainText('received');
  await expect(
    detail.getByRole('progressbar', { name: 'Run progress' }),
  ).toHaveAttribute('aria-valuetext', /\d+% complete/);
  await detail.getByRole('button', { name: 'Cancel run' }).click();
  await expect(detail.locator('.run-detail-header .status-badge')).toHaveText(
    'Cancelled',
    { timeout: 30_000 },
  );
});

test('filters history, compares mixed tracks, and exports both formats', async ({
  page,
  request,
}) => {
  const suiteName = uniqueName('Mixed track suite');
  const suite = await createSuite(request, {
    name: suiteName,
    workload: workload({ messages: 20 }),
    combinations: [
      { broker: 'redis', scenario: 'fan-out' },
      { broker: 'redis', scenario: 'competing-consumers' },
    ],
    repetitions: 1,
    orderStrategy: 'fixed',
    cooldownMs: 0,
  });
  await waitForSuite(request, suite.id);
  await page.goto(`/?suite=${suite.id}`);

  const detail = page.getByRole('region', { name: suiteName });
  await expect(
    detail.getByRole('region', { name: 'Ephemeral Redis Pub/Sub baseline' }),
  ).toBeVisible();
  await expect(
    detail.getByRole('region', { name: 'Adjacent Redis Streams track' }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  const jsonDownloadPromise = page.waitForEvent('download');
  await detail.getByRole('link', { name: 'Export JSON' }).click();
  const jsonDownload = await jsonDownloadPromise;
  const json = JSON.parse(
    await readFile(await jsonDownload.path(), 'utf8'),
  ) as {
    id: string;
  };
  expect(json.id).toBe(suite.id);

  const csvDownloadPromise = page.waitForEvent('download');
  await detail.getByRole('link', { name: 'Export CSV' }).click();
  const csvDownload = await csvDownloadPromise;
  const csv = await readFile(await csvDownload.path(), 'utf8');
  expect(csv).toContain('comparison_track');
  expect(csv).toContain('ephemeral-baseline');
  expect(csv).toContain('adjacent-streaming');

  const filters = page.getByLabel('History filters');
  await filters.getByLabel('Broker').selectOption('redis');
  await filters.getByLabel('Scenario').selectOption('competing-consumers');
  await filters.getByLabel('Status').selectOption('completed');
  await expect(page).toHaveURL(/broker=redis/);
  await expect(page).toHaveURL(/scenario=competing-consumers/);
  await expect(page).toHaveURL(/status=completed/);

  await filters.getByLabel('Scenario').selectOption('');
  await page.getByLabel(`Compare suite ${suiteName}`).check();
  const comparison = page.getByRole('region', { name: 'Semantic contrasts' });
  await expect(comparison).toContainText(
    'No shared winner, ranking, or combined aggregate is produced.',
  );
  await expect(comparison.getByRole('article')).toHaveCount(2);

  const historyLinks = page.locator('[data-history-link]');
  await historyLinks.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(historyLinks.nth(1)).toBeFocused();
  await expectNoA11yViolations(page);
});

test('has no automated accessibility violations in the initial dashboard', async ({
  page,
}) => {
  await openDashboard(page);
  await expectNoA11yViolations(page);

  await page.getByRole('link', { name: 'Experiment' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'History' })).toBeFocused();
});

async function openDashboard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Configure workloads' }),
  ).toBeVisible();
  await expect(page.getByText('healthy', { exact: true })).toHaveCount(3);
}

async function configureWorkload(
  page: Page,
  values: {
    messages: number;
    payloadBytes?: number;
    consumerDelayMs?: number;
  },
): Promise<void> {
  await page.getByLabel('Messages').fill(String(values.messages));
  if (values.payloadBytes !== undefined) {
    await page.getByLabel('Payload (bytes)').fill(String(values.payloadBytes));
  }
  if (values.consumerDelayMs !== undefined) {
    await page
      .getByRole('spinbutton', { name: /^Consumer delay \(ms\)/ })
      .fill(String(values.consumerDelayMs));
  }
}

async function selectOnlyCombination(page: Page, selectedIndex: number) {
  const checkboxes = page
    .getByRole('group', { name: 'Broker and scenario combinations' })
    .getByRole('checkbox');
  await expect(checkboxes).toHaveCount(6);
  for (let index = 0; index < 6; index += 1) {
    if (index !== selectedIndex) await checkboxes.nth(index).uncheck();
  }
}

async function expectNoA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

async function createSuite(
  request: APIRequestContext,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  const response = await request.post('/api/suites', { data: body });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { id: string };
}

async function waitForSuite(
  request: APIRequestContext,
  suiteId: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/suites/${suiteId}`);
        const suite = (await response.json()) as { status: string };
        return suite.status;
      },
      { timeout: 60_000 },
    )
    .toBe('completed');
}

function workload(overrides: { messages: number }) {
  return {
    messageCount: overrides.messages,
    payloadSizeBytes: 64,
    producerConcurrency: 1,
    consumerCount: 1,
    consumerDelayMs: 0,
    timeoutMs: 30_000,
  };
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}
