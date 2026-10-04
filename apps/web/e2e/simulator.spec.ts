import { createServer, type Server } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_SCENARIOS, formatShipResult, planRun, scenarioInput, simulateShip, type RunPlanInput, type RunPlanResult } from '@shipgate/core/browser';
import { placeFor } from '../src/lib/model';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')) as { version: string };
const TOKEN = ['ghp', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('_');

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

const decision = (page: Page) => page.getByRole('region', { name: 'Decision', exact: true });

async function verdict(page: Page): Promise<{ label: string; summary: string }> {
  return {
    label: (await decision(page).locator('.verdict-label').innerText()).trim(),
    summary: (await decision(page).locator('.verdict-summary').innerText()).trim(),
  };
}

/** The input and result the page used, read from the JSON disclosure in the Terminal tab. */
async function shownState(page: Page): Promise<{ input: RunPlanInput; result: RunPlanResult }> {
  await page.getByRole('tab', { name: 'Terminal' }).click();
  const details = page.locator('details.disclosure');
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator('summary').click();
  return JSON.parse(await details.locator('pre').innerText());
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pickExample = (page: Page, title: string) => page.getByRole('radio', { name: new RegExp(`^${escape(title)}`) }).click();
const toggle = (page: Page, name: string) => page.getByRole('switch', { name, exact: true });

async function choose(page: Page, combobox: string, option: string) {
  await page.getByRole('combobox', { name: combobox }).click();
  await page.getByRole('option', { name: new RegExp(`^${escape(option)}`) }).click();
}

let failures: string[] = [];
test.beforeEach(async ({ page }) => {
  failures = [];
  page.on('console', (msg) => {
    if (/scroll-linked positioning effect/.test(msg.text())) return;
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

test('initial render shows the default example, its decision, and every check', async ({ page }) => {
  await expect(page).toHaveTitle('Shipgate policy simulator');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Shipgate policy simulator');
  await expect(page.locator('.version')).toHaveText(`v${pkg.version}`);
  await expect(page.getByRole('radio', { name: /^Ordinary change/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'balanced', exact: true })).toBeChecked();
  expect(await verdict(page)).toEqual({ label: 'Ship', summary: EXPECTED['clean-change'].summary });
  await expect(decision(page).locator('.exit-chip')).toHaveText('exit 0');
  await expect(decision(page).getByText(/If the push fails, the commit stays local and ship exits 1/)).toBeVisible();
  const steps = page.getByRole('list', { name: 'Checks in the order ship runs them' }).getByRole('listitem');
  await expect(steps).toHaveCount(8);
  await expect(steps.first()).toContainText('Opt-in');
  await expect(steps.last()).toContainText('Would run');
  await expect(page.getByText('Runs in this browser. Nothing is staged, committed, pushed, or uploaded.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset' })).toHaveCount(0);
});

test('loads only same-origin assets and links only to the project', async ({ page, baseURL }) => {
  const requests: string[] = [];
  page.on('request', (req) => requests.push(req.url()));
  await page.reload();
  await page.waitForLoadState('networkidle');
  expect(requests.length).toBeGreaterThan(1);
  for (const url of requests) expect(url.startsWith(baseURL!) || url.startsWith('data:')).toBe(true);
  expect(requests.some((url) => /\/assets\/index-[\w-]+\.js$/.test(url))).toBe(true);
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((font) => font.status === 'loaded').map((font) => font.family.replace(/"/g, ''));
  });
  expect(fonts).toEqual(expect.arrayContaining(['IBM Plex Sans', 'IBM Plex Mono']));
  const licenses = await page.request.get(await page.getByRole('link', { name: 'Third-party licenses' }).evaluate((el) => (el as HTMLAnchorElement).href));
  expect(licenses.status()).toBe(200);
  expect(await licenses.text()).toContain('@fontsource/ibm-plex-mono@');
  for (const link of await page.getByRole('link').evaluateAll((els) => els.map((el) => (el as HTMLAnchorElement).href))) {
    expect(link).toMatch(/^(https:\/\/github\.com\/skysssup\/shipgate|http:\/\/127\.0\.0\.1)/);
  }
});

for (const scenario of DEMO_SCENARIOS) {
  test(`example "${scenario.title}" matches core, the documented outcome, and the CLI text`, async ({ page }) => {
    await pickExample(page, scenario.title);
    expect(await verdict(page)).toEqual({ label: EXPECTED[scenario.id].verdict, summary: EXPECTED[scenario.id].summary });
    const { input, result } = await shownState(page);
    expect(planRun(input)).toEqual(result);
    expect(result).toEqual(planRun(scenarioInput(scenario)));
    expect(input.findings).toEqual(scenarioInput(scenario).findings);
    const expected = formatShipResult(simulateShip(input, placeFor(input.remote)));
    const terminal = page.getByLabel('Simulated output of shipgate ship');
    await expect(terminal).toContainText(expected[0]);
    const text = await terminal.innerText();
    for (const line of expected) expect(text.replace(/\s+/g, ' ')).toContain(line.trim().replace(/\s+/g, ' '));
  });
}

test('policy level changes the decision for a medium finding', async ({ page }) => {
  await pickExample(page, 'Sample JWT in a test fixture');
  expect((await verdict(page)).label).toBe('Block');
  await page.getByRole('radio', { name: 'yolo', exact: true }).click();
  expect((await verdict(page)).label).toBe('Ship');
  await expect(decision(page).getByRole('listitem').filter({ hasText: '1 medium-confidence credential finding allowed by yolo.' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Findings and skipped placeholders' }).getByText('Allowed')).toBeVisible();
  await page.getByRole('radio', { name: 'strict', exact: true }).click();
  expect((await verdict(page)).label).toBe('Block');
});

test('every control feeds the planRun input', async ({ page }) => {
  await pickExample(page, 'API key in a .env file');
  const flags: Array<[string, keyof RunPlanInput['flags']]> = [
    ['--force-secrets', 'forceSecrets'],
    ['--public-ok', 'publicOk'],
    ['--confirm', 'confirm'],
  ];
  for (const [name, flag] of flags) {
    await toggle(page, name).click();
    expect((await shownState(page)).input.flags[flag]).toBe(true);
    await toggle(page, name).click();
    expect((await shownState(page)).input.flags[flag]).toBe(false);
  }
  await toggle(page, '-m').click();
  await page.getByLabel('Commit message').fill('Add settings');
  expect((await shownState(page)).input.flags.message).toBe('Add settings');
  await choose(page, 'origin', 'GitHub, visibility unknown');
  await page.getByRole('radiogroup', { name: 'Other agents busy' }).getByRole('radio', { name: '2' }).click();
  await choose(page, 'External review', 'On: review cannot run');
  await toggle(page, 'Uncommitted changes').click();
  await toggle(page, 'Shipgate enabled').click();
  const { input } = await shownState(page);
  expect(input).toMatchObject({
    remote: 'unknown',
    busyAgents: 2,
    configPresent: false,
    dirtyFiles: [],
    review: { enabled: true, outcome: 'unavailable', detail: 'no API key (set OPENROUTER_API_KEY or run shipgate on --key)' },
  });
});

test('acknowledging a public destination keeps the destination public', async ({ page }) => {
  await pickExample(page, 'Public destination on strict');
  await toggle(page, '--public-ok').click();
  expect((await verdict(page)).label).toBe('Ship');
  await expect(page.getByRole('combobox', { name: 'origin' })).toHaveText(/Public GitHub repository/);
  expect((await shownState(page)).input.remote).toBe('public');
  await expect(decision(page).getByRole('heading', { name: 'Recommendations' })).toBeVisible();
});

test('typing a credential into a file blocks the run and highlights it', async ({ page }) => {
  const editor = page.getByRole('textbox', { name: 'Contents of src/greeting.ts' });
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(`\nconst token = "${TOKEN}";`);
  await expect(decision(page).locator('.verdict-label')).toHaveText('Block');
  await expect(page.locator('.cm-secret-high')).toHaveText(TOKEN);
  const findings = page.getByRole('list', { name: 'Findings and skipped placeholders' });
  await expect(findings.getByRole('listitem')).toHaveCount(1);
  await expect(findings).toContainText('github-token');
  await expect(findings).toContainText('Blocks');
  await expect(findings).not.toContainText(TOKEN);
  await expect(page.getByRole('tab', { name: /greeting\.ts.*1 finding/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /^Ordinary change/ })).toContainText('Modified');

  await page.getByRole('tab', { name: 'src/greeting.test.ts', exact: true }).click();
  await findings.getByRole('button', { name: 'Show src/greeting.ts:3 in the editor' }).click();
  await expect(page.getByRole('tab', { name: /greeting\.ts.*1 finding/ })).toHaveAttribute('aria-selected', 'true');
  await expect(editor).toBeFocused();

  await page.getByRole('button', { name: 'Reset' }).first().click();
  expect((await verdict(page)).label).toBe('Ship');
  await expect(page.locator('.cm-secret-high')).toHaveCount(0);
});

test('renaming a file applies filename rules, and invalid paths are explained', async ({ page }) => {
  const path = page.getByLabel('Path of the selected file');
  await path.fill('.env.local');
  expect((await verdict(page)).label).toBe('Block');
  await expect(page.getByRole('list', { name: 'Findings and skipped placeholders' })).toContainText('dotenv-file');
  await path.fill('.env.example');
  expect((await verdict(page)).label).toBe('Ship');
  await path.fill('../outside.txt');
  await expect(page.getByText('Use a plain relative path without empty, . or .. parts.')).toBeVisible();
  await expect(path).toHaveAttribute('aria-invalid', 'true');
  expect((await shownState(page)).input.dirtyFiles).toContain('.env.example');
});

test('files can be added from rule samples and from this device, and removed', async ({ page }) => {
  await page.getByRole('button', { name: 'Add file' }).click();
  await page.getByRole('menuitem', { name: 'Sample for a rule' }).click();
  await page.getByRole('menuitem', { name: 'jwt', exact: true }).click();
  await expect(page.getByRole('tab', { name: /auth\.json/ })).toHaveAttribute('aria-selected', 'true');
  expect((await verdict(page)).label).toBe('Block');

  await page.locator('input[type="file"]').setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Notes\n') });
  await expect(page.getByRole('tab', { name: 'notes.md', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'Added notes.md. The contents stay in this browser.' })).toBeVisible();

  await page.getByRole('tab', { name: /auth\.json/ }).click();
  await page.getByRole('button', { name: 'Remove test/fixtures/auth.json from the change' }).click();
  expect((await verdict(page)).label).toBe('Ship');
  expect((await shownState(page)).input.dirtyFiles).toEqual(['src/greeting.ts', 'src/greeting.test.ts', 'notes.md']);
});

test('what-if suggestions are applied in one click and checked by core', async ({ page }) => {
  await pickExample(page, 'API key in a .env file');
  await page.getByRole('tab', { name: 'What-if' }).click();
  const force = page.getByRole('listitem').filter({ hasText: 'Pass --force-secrets' });
  await expect(force).toContainText('Only for false positives');
  await expect(force).toContainText('Ship');
  await force.getByRole('button', { name: 'Apply: Pass --force-secrets' }).click();
  expect((await verdict(page)).label).toBe('Ship');
  await expect(toggle(page, '--force-secrets')).toBeChecked();
  await expect(decision(page)).toBeFocused();
  const { input, result } = await shownState(page);
  expect(planRun(input)).toEqual(result);
});

test('the levels tab compares strict, balanced, and yolo and switches level', async ({ page }) => {
  await pickExample(page, 'Sample JWT in a test fixture');
  await page.getByRole('tab', { name: 'Levels' }).click();
  const rows = page.locator('.level-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Block');
  await expect(rows.nth(2)).toContainText('Ship');
  await page.getByRole('button', { name: 'Use yolo' }).click();
  await expect(page.getByRole('radio', { name: 'yolo', exact: true })).toBeChecked();
  expect((await verdict(page)).label).toBe('Ship');
});

test('share links restore the example and settings', async ({ page, browser, baseURL }) => {
  await pickExample(page, 'Sample JWT in a test fixture');
  await page.getByRole('radio', { name: 'yolo', exact: true }).click();
  await toggle(page, '--confirm').click();
  await choose(page, 'origin', 'Public GitHub repository');
  await page.getByRole('button', { name: 'Share' }).click();
  const url = await page.getByLabel('Link', { exact: true }).inputValue();
  expect(url).toBe(`${baseURL}#/?example=medium-jwt&level=yolo&origin=public&confirm=1`);
  await expect(page.getByText('Your edits to files or text are not in the link.')).toHaveCount(0);

  const other = await browser.newPage();
  await other.goto(url);
  await expect(other.getByRole('radio', { name: 'yolo', exact: true })).toBeChecked();
  await expect(other.getByRole('switch', { name: '--confirm', exact: true })).toBeChecked();
  await expect(other.locator('.verdict-label')).toHaveText('Ship');
  await other.close();

  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: /^Contents of/ }).click();
  await page.keyboard.type('x');
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page.getByText('Your edits to files or text are not in the link.')).toBeVisible();
});

test('the theme menu switches and remembers light and dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Theme: system' }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Theme: dark' }).click();
  await page.getByRole('menuitemradio', { name: 'System' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('the rules view lists every rule and tries one in the simulator', async ({ page }) => {
  await page.getByRole('link', { name: 'Rules' }).click();
  await expect(page).toHaveTitle('Credential rules and policy · Shipgate');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await expect(page.locator('.rules-table tbody tr')).toHaveCount(12);
  const policy = page.locator('.policy-table');
  await expect(policy.getByRole('row', { name: /Medium-confidence finding/ })).toContainText('Allows, with a warning');
  await page.getByRole('button', { name: 'Try npm-token in the simulator' }).click();
  await expect(page).toHaveTitle('Shipgate policy simulator');
  await expect(page.getByRole('tab', { name: /\.npmrc/ })).toHaveAttribute('aria-selected', 'true');
  expect((await verdict(page)).label).toBe('Block');
  await page.goBack();
  await expect(page).toHaveTitle('Credential rules and policy · Shipgate');
});

test('the get started view gives install commands for this version', async ({ page }) => {
  await page.getByRole('link', { name: 'Get started' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Use Shipgate in a repository');
  await expect(page.getByText(`releases/download/v${pkg.version}/shipgate-cli-${pkg.version}.tgz`)).toBeVisible();
  await expect(page.getByText('shipgate demo --serve')).toBeVisible();
});

test('announces decision changes through one polite live region', async ({ page }) => {
  const live = page.locator('.announcer');
  await expect(live).toHaveAttribute('aria-live', 'polite');
  await expect(live).toHaveText('');
  await pickExample(page, 'Another agent is mid-turn');
  await expect(live).toHaveText('Decision: Hold. Another agent is still working here, so Shipgate waits.');
});

test('works with the keyboard alone, with visible focus', async ({ page }) => {
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();

  const first = page.getByRole('radio', { name: /^Ordinary change/ });
  await page.keyboard.press('Tab');
  if (await page.getByRole('complementary', { name: 'Examples' }).evaluate((el) => el === document.activeElement)) await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  expect(await first.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.keyboard.press('ArrowDown', { delay: 60 });
  await expect(page.getByRole('radio', { name: /^API key in a \.env file/ })).toBeChecked();
  expect((await verdict(page)).label).toBe('Block');

  await page.keyboard.press('Tab');
  await expect(page.getByRole('radio', { name: 'balanced', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight', { delay: 60 });
  await expect(page.getByRole('radio', { name: 'yolo', exact: true })).toBeChecked();

  const force = toggle(page, '--force-secrets');
  await force.focus();
  await page.keyboard.press('Space');
  await expect(force).toBeChecked();
  expect((await verdict(page)).label).toBe('Ship');

  const checks = page.getByRole('tab', { name: 'Checks' });
  await checks.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'What-if' })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: 'Reset' }).first().focus();
  await page.keyboard.press('Enter');
  await expect(force).not.toBeChecked();
});

for (const width of [360, 390, 640, 768, 1024, 1280, 1440]) {
  test(`layout fits a ${width}px viewport without horizontal page scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('./#/?example=credential-in-env');
    await expect(decision(page).locator('.verdict-label')).toHaveText('Block');
    for (const view of ['#/?example=credential-in-env', '#/rules', '#/start']) {
      await page.goto(`./${view}`);
      await page.waitForTimeout(100);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, view).toBeLessThanOrEqual(0);
    }
    await page.goto('./#/?example=credential-in-env');
    const sidebar = page.getByRole('complementary', { name: 'Examples' });
    const picker = page.getByRole('combobox', { name: 'Example' });
    if (width >= 1280) {
      await expect(sidebar).toBeVisible();
      await expect(picker).toBeHidden();
    } else {
      await expect(sidebar).toBeHidden();
      await expect(picker).toBeVisible();
    }
    const bar = page.locator('.mobile-verdict');
    if (width < 1024) {
      await expect(bar).toBeHidden();
      await page.getByRole('heading', { name: 'Scan results' }).scrollIntoViewIfNeeded();
      await expect(bar).toBeVisible();
      await expect(bar).toContainText('Credential findings block this run.');
    } else {
      await expect(bar).toBeHidden();
    }
  });
}

test('the example picker works on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await choose(page, 'Example', 'Another agent is mid-turn');
  expect((await verdict(page)).label).toBe('Hold');
});

test('respects reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const durations = await page.locator('button, a, .switch-thumb').evaluateAll((els) => els.map((el) => getComputedStyle(el).transitionDuration));
  expect(durations.length).toBeGreaterThan(10);
  for (const duration of durations) expect(duration.split(',').every((d) => parseFloat(d) <= 0.00001)).toBe(true);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`text meets WCAG AA contrast in the ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    const pages = ['#/?example=credential-in-env', '#/?example=busy-agent', '#/?example=placeholder-template&level=yolo', '#/?example=medium-jwt&level=yolo', '#/rules', '#/start'];
    for (const view of pages) {
      await page.goto(`./${view}`);
      await page.waitForTimeout(100);
      for (const tab of view.startsWith('#/?') ? ['Checks', 'What-if', 'Levels', 'Terminal'] : [null]) {
        if (tab) await page.getByRole('tab', { name: tab }).click();
        const ratios = await page.evaluate(() => {
          const parse = (c: string): number[] => {
            const numbers = (c.match(/[\d.]+/g) ?? []).map(Number);
            return c.startsWith('color(srgb') ? [...numbers.slice(0, 3).map((n) => n * 255), numbers[3] ?? 1] : numbers;
          };
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
          const texts: Element[] = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const parent = node.parentElement;
            if (!parent || !node.textContent?.trim() || texts.includes(parent)) continue;
            const style = getComputedStyle(parent);
            const box = parent.getBoundingClientRect();
            if (style.visibility === 'hidden' || box.width <= 1 || box.height <= 1 || parent.closest('[aria-hidden="true"], .sr-only, .cm-placeholder')) continue;
            texts.push(parent);
          }
          return texts.map((el) => {
            const fg = parse(getComputedStyle(el).color);
            const bg = background(el);
            const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
            return { text: (el.textContent ?? '').trim().slice(0, 40), ratio: (l1 + 0.05) / (l2 + 0.05) };
          });
        });
        expect(ratios.length).toBeGreaterThan(10);
        for (const { text, ratio } of ratios) expect(ratio, `${colorScheme} ${view} ${tab ?? ''}: "${text}"`).toBeGreaterThanOrEqual(4.5);
      }
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
      const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    const port = (server.address() as { port: number }).port;
    await page.goto(`http://127.0.0.1:${port}/tools/shipgate/#/?example=medium-jwt&level=yolo`);
    expect((await verdict(page)).label).toBe('Ship');
    await page.getByRole('link', { name: 'Rules' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Credential rules and policy');
  } finally {
    server.close();
  }
});
