import { createServer, type Server } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_SCENARIOS, planRun, type RunPlanInput } from '@shipgate/core/browser';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')) as { version: string };

/** Independently written expectations for each example: label and summary shown in the UI. */
const EXPECTED: Record<string, { verdict: string; summary: string }> = {
  'clean-change': { verdict: 'Ship', summary: 'The balanced policy allows this run.' },
  'credential-in-env': { verdict: 'Block', summary: 'Credential findings block this run.' },
  'placeholder-template': { verdict: 'Ship', summary: 'The balanced policy allows this run.' },
  'medium-jwt': { verdict: 'Block', summary: 'Credential findings block this run.' },
  'public-repo': { verdict: 'Block', summary: 'Strict policy blocks a public destination until you acknowledge it.' },
  'busy-agent': { verdict: 'Hold', summary: 'Another agent is still working here, so Shipgate waits.' },
  'not-enabled': { verdict: 'Block', summary: 'Shipgate is not enabled in this repository.' },
  'review-hold': { verdict: 'Hold', summary: 'External review asked to hold this change.' },
};

const decision = (page: Page) => page.getByRole('region', { name: /Decision/ });

async function verdict(page: Page): Promise<{ label: string; summary: string }> {
  const panel = decision(page);
  return {
    label: (await panel.locator('.verdict-label').innerText()).trim(),
    summary: (await panel.locator('.summary').innerText()).trim(),
  };
}

/** Read the input and result the page used, from the debug disclosure. */
async function debugState(page: Page): Promise<{ input: RunPlanInput; result: ReturnType<typeof planRun> }> {
  const details = decision(page).locator('details');
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator('summary').click();
  return JSON.parse(await details.locator('pre').innerText());
}

function pickExample(page: Page, title: string) {
  return page.getByRole('radio', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).check();
}

let failures: string[] = [];
test.beforeEach(async ({ page }) => {
  failures = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') failures.push(`console ${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => failures.push(`request failed: ${req.url()}`));
  page.on('response', (res) => {
    if (res.status() >= 400) failures.push(`HTTP ${res.status()}: ${res.url()}`);
  });
  await page.goto('./');
});
test.afterEach(() => {
  expect(failures).toEqual([]);
});

test('initial render explains the page and shows a ship decision for the default example', async ({ page }) => {
  await expect(page).toHaveTitle('Shipgate policy simulator');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What would shipgate ship do here, and why?');
  await expect(page.getByText('This page is a simulator.')).toBeVisible();
  await expect(page.locator('.version')).toHaveText(`v${pkg.version}`);
  await expect(page.getByRole('radio', { name: /^Ordinary change/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /^balanced/ })).toBeChecked();
  expect(await verdict(page)).toEqual({ label: 'SHIP', summary: EXPECTED['clean-change'].summary });
  await expect(decision(page).getByText('None. No gate stops this run.')).toBeVisible();
  await expect(decision(page).getByText('A decision to ship does not mean the push will succeed.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset to example' })).toHaveAttribute('aria-disabled', 'true');
  await expect(decision(page).locator('details')).not.toHaveAttribute('open', '');
});

test('loads only same-origin production assets', async ({ page, baseURL }) => {
  const requests: string[] = [];
  page.on('request', (req) => requests.push(req.url()));
  await page.reload();
  await page.waitForLoadState('networkidle');
  expect(requests.length).toBeGreaterThan(1);
  for (const url of requests) expect(url.startsWith(baseURL!) || url.startsWith('data:')).toBe(true);
  expect(requests.some((url) => /\/assets\/index-[\w-]+\.js$/.test(url))).toBe(true);
  for (const link of await page.getByRole('link').evaluateAll((els) => els.map((el) => (el as HTMLAnchorElement).href))) {
    expect(link).toMatch(/^(https:\/\/github\.com\/skysssup\/shipgate|http:\/\/127\.0\.0\.1)/);
  }
});

for (const scenario of DEMO_SCENARIOS) {
  test(`example "${scenario.title}" matches core and the documented outcome`, async ({ page }) => {
    await pickExample(page, scenario.title);
    const shown = await verdict(page);
    expect(shown.label).toBe(EXPECTED[scenario.id].verdict.toUpperCase());
    expect(shown.summary).toBe(EXPECTED[scenario.id].summary);
    const { input, result } = await debugState(page);
    expect(planRun(input)).toEqual(result);
    expect(result.summary).toBe(shown.summary);
    await expect(decision(page).getByText(`Example: ${scenario.title}.`)).toBeVisible();
  });
}

test('policy level changes the decision for a medium finding, and shows the yolo warning', async ({ page }) => {
  await pickExample(page, 'Sample JWT in a test fixture');
  expect((await verdict(page)).label).toBe('BLOCK');
  await page.getByRole('radio', { name: /^yolo / }).check();
  expect((await verdict(page)).label).toBe('SHIP');
  await expect(decision(page).locator('.verdict-level')).toHaveText('Policy: yolo');
  await expect(decision(page).getByRole('heading', { name: 'Warnings (shown even when shipping)' })).toBeVisible();
  await expect(decision(page).getByRole('listitem').filter({ hasText: '1 medium-confidence credential finding allowed by yolo.' })).toBeVisible();
  await page.getByRole('radio', { name: /^strict / }).check();
  expect((await verdict(page)).label).toBe('BLOCK');
});

test('effective inputs always match the visible controls', async ({ page }) => {
  await pickExample(page, 'API key in a .env file');
  const checks: Array<[RegExp, keyof RunPlanInput['flags']]> = [
    [/^Override findings/, 'forceSecrets'],
    [/^Accept a public destination/, 'publicOk'],
    [/^Record a human check/, 'confirm'],
  ];
  for (const [name, flag] of checks) {
    const box = page.getByRole('checkbox', { name });
    await box.check();
    expect((await debugState(page)).input.flags[flag]).toBe(true);
    await box.uncheck();
    expect((await debugState(page)).input.flags[flag]).toBe(false);
  }
  await page.getByRole('checkbox', { name: /^Give a commit message/ }).check();
  expect((await debugState(page)).input.flags.message).toBe('Describe the change');
  await page.getByLabel('Push destination (origin)').selectOption('unknown');
  await page.getByLabel('Other agents marked busy').selectOption('2');
  await page.getByLabel('External review (shipgate on --agent)').selectOption('unavailable');
  const { input } = await debugState(page);
  expect(input).toMatchObject({ remote: 'unknown', busyAgents: 2, review: { enabled: true, outcome: 'unavailable' } });
});

test('acknowledging a public destination keeps the destination public', async ({ page }) => {
  await pickExample(page, 'Public destination on strict');
  await page.getByRole('checkbox', { name: /^Accept a public destination/ }).check();
  expect((await verdict(page)).label).toBe('SHIP');
  await expect(page.getByLabel('Push destination (origin)')).toHaveValue('public');
  expect((await debugState(page)).input.remote).toBe('public');
  await expect(decision(page).getByRole('heading', { name: 'Recommendations (not enforced)' })).toBeVisible();
});

test('override, then reset and example changes restore documented values', async ({ page }) => {
  await pickExample(page, 'API key in a .env file');
  const override = page.getByRole('checkbox', { name: /^Override findings/ });
  await override.check();
  expect((await verdict(page)).label).toBe('SHIP');
  await expect(decision(page).getByRole('listitem').filter({ hasText: 'overridden with --force-secrets' })).toBeVisible();
  const reset = page.getByRole('button', { name: 'Reset to example' });
  await expect(reset).toHaveAttribute('aria-disabled', 'false');
  await reset.click();
  await expect(override).not.toBeChecked();
  await expect(reset).toHaveAttribute('aria-disabled', 'true');
  await reset.click({ force: true });
  expect((await verdict(page)).label).toBe('BLOCK');
  expect((await verdict(page)).label).toBe('BLOCK');

  await override.check();
  await pickExample(page, 'Ordinary change');
  await expect(override).not.toBeChecked();
  expect((await debugState(page)).input.flags.forceSecrets).toBe(false);
});

test('announces decision changes through one polite live region', async ({ page }) => {
  const live = page.locator('[aria-live="polite"]');
  await expect(live).toHaveCount(1);
  await pickExample(page, 'Another agent is mid-turn');
  await expect(live).toHaveText('Decision: Hold. Another agent is still working here, so Shipgate waits.');
});

test('works with the keyboard alone, with visible focus', async ({ page }) => {
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to the simulator' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('#simulator')).toBeFocused();

  await page.keyboard.press('Tab');
  const first = page.getByRole('radio', { name: /^Ordinary change/ });
  await expect(first).toBeFocused();
  const outline = await first.evaluate((el) => getComputedStyle(el.closest('label')!).outlineStyle);
  expect(outline).toBe('solid');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /^API key in a \.env file/ })).toBeChecked();
  expect((await verdict(page)).label).toBe('BLOCK');

  const override = page.getByRole('checkbox', { name: /^Override findings/ });
  await override.focus();
  await page.keyboard.press('Space');
  await expect(override).toBeChecked();
  expect((await verdict(page)).label).toBe('SHIP');

  const reset = page.getByRole('button', { name: 'Reset to example' });
  await reset.focus();
  await page.keyboard.press('Enter');
  await expect(override).not.toBeChecked();
  await expect(reset).toBeFocused();

  const details = decision(page).locator('details summary');
  await details.focus();
  await page.keyboard.press('Enter');
  await expect(decision(page).locator('details')).toHaveAttribute('open', '');
});

for (const width of [360, 390, 640, 768, 1024, 1440]) {
  test(`layout fits a ${width}px viewport without horizontal page scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await pickExample(page, 'API key in a .env file');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const compact = page.locator('.compact-decision');
    if (width < 1024) await expect(compact).toBeVisible();
    else await expect(compact).toBeHidden();
    for (const box of await page.locator('label.option, label.choice, select, button').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))) {
      expect(box.right).toBeLessThanOrEqual(width + 0.5);
      expect(box.height).toBeGreaterThanOrEqual(43.5);
    }
    const code = decision(page).locator('pre.code').first();
    const codeBox = await code.boundingBox();
    expect(codeBox!.x + codeBox!.width).toBeLessThanOrEqual(width);
  });
}

test('respects reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const durations = await page.locator('.choice, button').evaluateAll((els) => els.map((el) => getComputedStyle(el).transitionDuration));
  for (const duration of durations) expect(duration.split(',').every((d) => parseFloat(d) === 0)).toBe(true);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`text meets WCAG AA contrast in the ${colorScheme} scheme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    for (const id of ['credential-in-env', 'busy-agent', 'clean-change', 'not-enabled']) {
      await pickExample(page, DEMO_SCENARIOS.find((s) => s.id === id)!.title);
      const ratios = await page.evaluate(() => {
        const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
        const lum = ([r, g, b]: number[]) => {
          const f = (v: number) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const background = (el: Element): number[] => {
          const layers: number[][] = [];
          for (let node: Element | null = el; node; node = node.parentElement) {
            const c = parse(getComputedStyle(node).backgroundColor);
            if (c.length >= 3 && (c[3] ?? 1) > 0) layers.unshift(c);
            if (c.length >= 3 && (c[3] ?? 1) === 1) break;
          }
          let out = [255, 255, 255];
          for (const [r, g, b, a = 1] of layers) out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
          return out;
        };
        const sel = '.summary, .verdict-label, .verdict-meaning, .choice-text, .option-help, .hint, .muted, a, legend, .finding, .tech, code';
        return [...document.querySelectorAll(sel)].filter((el) => (el as HTMLElement).offsetParent).map((el) => {
          const fg = parse(getComputedStyle(el).color);
          const bg = background(el);
          const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
          return { text: (el.textContent ?? '').slice(0, 40), ratio: (l1 + 0.05) / (l2 + 0.05) };
        });
      });
      for (const { text, ratio } of ratios) expect(ratio, `${colorScheme}: "${text}"`).toBeGreaterThanOrEqual(4.5);
    }
  });
}

test('the build works when served from a subdirectory', async ({ page }) => {
  const dist = resolve(here, '../dist');
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (!path.startsWith('/tools/shipgate/')) return void res.writeHead(404).end();
    let file = join(dist, path.slice('/tools/shipgate/'.length) || 'index.html');
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type }).end(readFileSync(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    const port = (server.address() as { port: number }).port;
    await page.goto(`http://127.0.0.1:${port}/tools/shipgate/`);
    expect((await verdict(page)).label).toBe('SHIP');
  } finally {
    server.close();
  }
});
