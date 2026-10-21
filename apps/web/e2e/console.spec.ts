import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page } from '@playwright/test';
import { contrastRatios } from './contrast';

/**
 * Browser tests for the repository console. Each test gets its own repository with a
 * local bare origin and its own `shipgate ui` server (the built CLI serving the built web
 * app), with Git, Shipgate, and agent-hook settings sandboxed in a temporary directory.
 */

const here = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(here, '../../../packages/cli/dist/bin.js');
const KEY = ['sk', 'proj', 'consoleTest0123456789abcdefXYZ'].join('-');

interface Repo {
  dir: string;
  origin: string;
  url: string;
  sandbox: string;
  git: (...args: string[]) => string;
  write: (path: string, content: string) => void;
  stop: () => void;
}

function startConsole(sandbox: string, dir: string, env: NodeJS.ProcessEnv): Promise<{ url: string; child: ChildProcess }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [BIN, 'ui', '--port', '0'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => reject(new Error(`shipgate ui did not start: ${out}${err}`)), 15000);
    child.stdout!.on('data', (chunk) => {
      out += chunk;
      const match = /(http:\/\/127\.0\.0\.1:\d+\/#\/repo)/.exec(out);
      if (match) {
        clearTimeout(timer);
        resolvePromise({ url: match[1], child });
      }
    });
    child.stderr!.on('data', (chunk) => (err += chunk));
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`shipgate ui exited with ${code}: ${err}`));
    });
    void sandbox;
  });
}

const test = base.extend<{ repo: Repo }>({
  repo: async ({}, use) => {
    if (!existsSync(BIN)) throw new Error(`${BIN} is missing; run npm run build first`);
    const sandbox = mkdtempSync(join(tmpdir(), 'shipgate-console-e2e-'));
    const gitconfig = join(sandbox, 'gitconfig');
    writeFileSync(gitconfig, '[user]\n\tname = Console Test\n\temail = console@example.invalid\n[init]\n\tdefaultBranch = main\n[gc]\n\tauto = 0\n');
    const env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: gitconfig,
      GIT_CONFIG_NOSYSTEM: '1',
      SHIPGATE_HOME: join(sandbox, 'home'),
      SHIPGATE_CLAUDE_SETTINGS: join(sandbox, 'claude', 'settings.json'),
      SHIPGATE_CURSOR_HOOKS: join(sandbox, 'cursor', 'hooks.json'),
      OPENROUTER_API_KEY: '',
    };
    const origin = join(sandbox, 'origin.git');
    const dir = join(sandbox, 'demo-repo');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' }).trimEnd();
    execFileSync('git', ['init', '--quiet', '--bare', origin], { env });
    execFileSync('git', ['init', '--quiet', '-b', 'main', dir], { env });
    writeFileSync(join(dir, 'README.md'), 'demo\n');
    writeFileSync(join(dir, '.git', 'info', 'exclude'), '.shipgate.json\n');
    git('add', 'README.md');
    git('commit', '--quiet', '-m', 'Initial commit');
    git('remote', 'add', 'origin', origin);
    git('push', '--quiet', '--set-upstream', 'origin', 'main');
    const { url, child } = await startConsole(sandbox, dir, env);
    const repo: Repo = {
      dir,
      origin,
      url,
      sandbox,
      git,
      write: (path, content) => {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), content);
      },
      stop: () => child.kill(),
    };
    await use(repo);
    child.kill();
    rmSync(sandbox, { recursive: true, force: true });
  },
});

const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const card = (page: Page, title: string) => page.getByRole('list', { name: 'Repository status' }).getByRole('listitem').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
const verdict = (page: Page) => section(page, 'Preview and ship').locator('.preview-verdict');

let failures: string[] = [];
test.beforeEach(({ page }) => {
  failures = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') failures.push(`console ${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));
});
test.afterEach(() => {
  expect(failures).toEqual([]);
});

async function enable(page: Page) {
  await section(page, 'Settings').getByRole('button', { name: 'Enable Shipgate' }).click();
  await expect(page.getByRole('region', { name: /^Done: / })).toContainText('enabled .shipgate.json');
  await expect(card(page, 'Policy')).toContainText('balanced');
}

test('a repository that has not opted in shows how to enable it', async ({ page, repo }) => {
  await page.goto(repo.url);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('demo-repo');
  await expect(page).toHaveTitle('demo-repo · Repository console · Shipgate');
  await expect(page.getByRole('link', { name: /Repository/ })).toHaveAttribute('aria-current', 'page');
  await expect(card(page, 'Branch')).toContainText('main');
  await expect(card(page, 'Policy')).toContainText('Not enabled');
  await expect(card(page, 'Destination')).toContainText('Not GitHub');
  await expect(card(page, 'Agent hooks')).toContainText('Not installed');
  await expect(verdict(page)).toContainText('Shipgate is not enabled in this repository.');
  await expect(page.getByRole('button', { name: 'Ship…' })).toBeDisabled();
  await expect(page.locator('#ship-reason')).toHaveText('Enable Shipgate in Settings first.');
  await expect(section(page, 'History').getByRole('row')).toHaveCount(2);
  await expect(section(page, 'History')).toContainText('Initial commit');
  await expect(section(page, 'History')).toContainText('pushed');

  await enable(page);
  expect(JSON.parse(readFileSync(join(repo.dir, '.shipgate.json'), 'utf8'))).toMatchObject({ enabled: true, level: 'balanced' });
  await expect(page.locator('#ship-reason')).toHaveText('There are no changes to ship.');
  await expect(section(page, 'Preview and ship')).toContainText('No changes. The working tree matches HEAD.');
});

test('previews a credential, then ships a clean change and undoes it', async ({ page, repo }) => {
  await page.goto(repo.url);
  await enable(page);

  repo.write('.env', `OPENAI_API_KEY=${KEY}\n`);
  repo.write('greet.js', 'export const greet = (n) => `Hi ${n}`;\n');
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(verdict(page)).toContainText('Credential findings block this run.');
  const preview = section(page, 'Preview and ship');
  await expect(preview.getByRole('region', { name: /Findings/ })).toContainText('openai-key');
  await expect(preview.getByRole('region', { name: /Findings/ })).toContainText('.env:1');
  await expect(preview.getByRole('region', { name: /Changes/ })).toContainText('greet.js');
  await expect(page.getByRole('button', { name: 'Ship…' })).toBeDisabled();
  // The preview never stages: the real index is untouched.
  expect(repo.git('status', '--porcelain')).toBe('?? .env\n?? greet.js');

  // A run flag re-runs the preview with the same flag ship would get.
  await page.getByRole('button', { name: '--force-secrets', exact: true }).click();
  await expect(verdict(page)).toContainText('allows this run');
  await expect(section(page, 'Preview and ship').locator('.section-meta')).toHaveText('shipgate preview --force-secrets');
  await page.getByRole('button', { name: '--force-secrets', exact: true }).click();
  await expect(verdict(page)).toContainText('Credential findings block this run.');

  rmSync(join(repo.dir, '.env'));
  await page.getByLabel(/Commit message/).fill('Add greet helper');
  await expect(verdict(page)).toContainText('The balanced policy allows this run.');
  await expect(preview).toContainText('Commit subject: Add greet helper');
  const ship = page.getByRole('button', { name: 'Ship…' });
  await expect(ship).toBeEnabled();

  // Escape cancels; focus starts on Cancel.
  await ship.click();
  const dialog = page.getByRole('dialog', { name: 'Ship these changes?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(dialog).toContainText('$ shipgate ship -m "Add greet helper"');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(repo.git('log', '--oneline').split('\n')).toHaveLength(1);

  await ship.click();
  await dialog.getByRole('button', { name: 'Ship', exact: true }).click();
  const result = page.getByRole('region', { name: /^Done: shipgate ship/ });
  await expect(result).toBeFocused();
  await expect(result).toContainText('shipgate: SHIPPED — Pushed');
  expect(execFileSync('git', ['--git-dir', repo.origin, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()).toBe('Add greet helper');

  const history = section(page, 'History');
  const head = history.getByRole('row').nth(1);
  await expect(head).toContainText('Add greet helper');
  await expect(head).toContainText('Shipgate');
  await expect(head).toContainText('pushed');

  await history.getByRole('button', { name: 'Undo last ship…' }).click();
  const undo = page.getByRole('dialog', { name: 'Undo the last ship?' });
  await expect(undo).toContainText('Add greet helper');
  await undo.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('region', { name: /^Done: shipgate undo/ })).toContainText('origin');
  await expect(history.getByRole('row').nth(1)).toContainText('Initial commit');
  await expect(history.getByRole('button', { name: 'Undo last ship…' })).toHaveCount(0);
  expect(readFileSync(join(repo.dir, 'greet.js'), 'utf8')).toContain('greet');
  await expect(verdict(page)).toContainText('allows this run');
});

test('edits settings with validation, then disables Shipgate', async ({ page, repo }) => {
  await page.goto(repo.url);
  await enable(page);
  const settings = section(page, 'Settings');
  await expect(settings.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  await expect(settings).toContainText('No unsaved changes.');

  await settings.getByRole('radio', { name: 'strict' }).click();
  await expect(settings).toContainText('Blocks every finding and unacknowledged public destinations');
  await settings.getByLabel(/GitHub account/).fill('not a login!');
  await expect(settings.getByText('A GitHub login: letters, digits')).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  await settings.getByLabel(/GitHub account/).fill('octocat');
  await settings.getByLabel(/Acknowledge public destinations/).check();
  await expect(settings.locator('.command code')).toHaveText('$ shipgate on --level strict --public-ok --account octocat');
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('region', { name: /^Done: shipgate on --level strict/ })).toBeVisible();
  await expect(card(page, 'Policy')).toContainText('strict');
  await expect(card(page, 'Policy')).toContainText('Account octocat');
  expect(JSON.parse(readFileSync(join(repo.dir, '.shipgate.json'), 'utf8'))).toMatchObject({ level: 'strict', publicOk: true, account: 'octocat' });

  await settings.getByRole('button', { name: 'Disable…' }).click();
  await page.getByRole('dialog', { name: 'Disable Shipgate here?' }).getByRole('button', { name: 'Disable', exact: true }).click();
  await expect(card(page, 'Policy')).toContainText('Disabled');
  await expect(settings.getByRole('button', { name: 'Enable with these settings' })).toBeEnabled();
  expect(JSON.parse(readFileSync(join(repo.dir, '.shipgate.json'), 'utf8'))).toMatchObject({ enabled: false, level: 'strict' });
});

test('an invalid .shipgate.json is explained and not overwritten', async ({ page, repo }) => {
  repo.write('.shipgate.json', '{"level":"loose"}');
  await page.goto(repo.url);
  await expect(card(page, 'Policy')).toContainText('Invalid');
  await expect(section(page, 'Settings').getByRole('alert')).toContainText('"level" must be');
  await expect(section(page, 'Settings').getByRole('button')).toHaveCount(0);
  await expect(verdict(page)).toContainText('.shipgate.json is invalid');
});

test('installs agent hooks after confirmation', async ({ page, repo }) => {
  await page.goto(repo.url);
  await card(page, 'Agent hooks').getByRole('button', { name: 'Install hooks…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Install agent hooks?' });
  await expect(dialog).toContainText(join(repo.sandbox, 'claude', 'settings.json'));
  await dialog.getByRole('button', { name: 'Install hooks' }).click();
  await expect(card(page, 'Agent hooks')).toContainText('Installed');
  expect(existsSync(join(repo.sandbox, 'cursor', 'hooks.json'))).toBe(true);
});

test('keeps the last data and explains when the server stops', async ({ page, repo }) => {
  await page.goto(repo.url);
  await expect(card(page, 'Branch')).toContainText('main');
  repo.stop();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('alert').first()).toContainText('The console server is not answering');
  await expect(card(page, 'Branch')).toContainText('main');
  failures = failures.filter((f) => !/Failed to load resource|ERR_CONNECTION_REFUSED|NetworkError/.test(f));
});

test('works with the keyboard alone', async ({ page, repo }) => {
  await page.goto(repo.url);
  await enable(page);
  repo.write('notes.md', 'hello\n');
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('button', { name: 'Ship…' })).toBeEnabled();
  await page.getByLabel(/Commit message/).focus();
  await page.keyboard.type('Add notes');
  // Typing re-runs the preview after a pause, and Ship is disabled (so not focusable) while
  // it loads; wait for the preview of this message before tabbing to Ship.
  await expect(section(page, 'Preview and ship')).toContainText('Commit subject: Add notes');
  await expect(page.getByRole('button', { name: 'Ship…' })).toBeEnabled();
  let reached = false;
  for (let i = 0; i < 12 && !reached; i += 1) {
    await page.keyboard.press('Tab');
    reached = await page.getByRole('button', { name: 'Ship…' }).evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Ship these changes?' });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Ship', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: /^Done: shipgate ship -m "Add notes"/ })).toBeFocused();
  await expect(page.locator('.console-announcer')).toContainText('shipgate ship -m "Add notes"');
});

test('a long change list can be searched, filtered by status, and paged', async ({ page, repo }) => {
  for (let i = 0; i < 125; i += 1) repo.write(`bulk/file-${i}.txt`, `${i}\n`);
  repo.write('README.md', 'changed\n');
  await page.goto(repo.url);
  const changes = section(page, 'Preview and ship').getByRole('region', { name: /Changes/ });
  const rows = changes.locator('.change');
  await expect(changes.locator('.count')).toHaveText('126');
  await expect(rows).toHaveCount(100);
  await expect(changes.getByRole('status')).toHaveText('Showing 100 of 126 paths');
  await changes.getByRole('button', { name: 'Show 26 more' }).click();
  await expect(rows).toHaveCount(126);
  await expect(changes.getByRole('status')).toHaveText('126 paths');

  const search = changes.getByLabel('Filter changed paths');
  await search.fill('FILE-12');
  await expect(rows).toHaveCount(6);
  await expect(changes.getByRole('status')).toHaveText('6 of 126 paths match');
  // The filter survives a refresh of the preview.
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  await expect(search).toHaveValue('FILE-12');
  await expect(rows).toHaveCount(6);

  await changes.getByRole('radio', { name: 'Modified 1' }).click();
  await expect(changes).toContainText('No changed paths match the filter.');
  await changes.getByRole('button', { name: 'Clear filter' }).click();
  await expect(search).toHaveValue('');
  await expect(changes.getByRole('radio', { name: 'All 126' })).toBeChecked();
  await expect(rows).toHaveCount(100);
  await changes.getByRole('radio', { name: 'Modified 1' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveText(/README\.md/);

  // The search and status filter wrap on a narrow phone instead of widening the page.
  await page.setViewportSize({ width: 360, height: 800 });
  const [scrollWidth, innerWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
});

test('a long history can be filtered and extended with Show more', async ({ page, repo }) => {
  for (let i = 1; i <= 40; i += 1) repo.git('commit', '--quiet', '--allow-empty', '-m', `Change ${i}`);
  await page.goto(repo.url);
  const history = section(page, 'History');
  const rows = history.locator('tbody tr');
  await expect(rows).toHaveCount(30);
  await expect(rows.first()).toContainText('Change 40');
  await expect(history.getByRole('status')).toHaveText('Newest 30 commits');
  await history.getByRole('button', { name: 'Show 30 more' }).click();
  await expect(rows).toHaveCount(41);
  await expect(rows.last()).toContainText('Initial commit');
  await expect(history.getByRole('status')).toHaveText('All 41 commits on main');
  await expect(history.getByRole('button', { name: /^Show \d+ more$/ })).toHaveCount(0);
  // A refresh keeps the longer list.
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  await expect(rows).toHaveCount(41);

  const search = history.getByLabel(/Filter commits/);
  // Every term must match: Change 3, 13, 23, and 30 to 39.
  await search.fill('change 3');
  await expect(rows).toHaveCount(13);
  await expect(history.getByRole('status')).toHaveText('13 of 41 loaded commits match');
  const sha = repo.git('rev-parse', 'HEAD~5');
  await search.fill(sha.slice(0, 7).toUpperCase());
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Change 35');
  await search.fill('no such commit');
  await expect(history).toContainText('No loaded commits match the filter.');
  await history.getByRole('button', { name: 'Clear filter' }).click();
  await expect(rows).toHaveCount(41);
});

test('a run flag re-runs the preview at once; typing waits for a pause', async ({ page, repo }) => {
  await page.clock.install();
  await page.goto(repo.url);
  await enable(page);
  repo.write('notes.md', 'hello\n');
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('button', { name: 'Ship…' })).toBeEnabled();
  let previews = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/preview')) previews += 1;
  });

  // Freeze the page's timers, so only an immediate preview can be sent.
  await page.clock.pauseAt(Date.now() + 1000);
  await page.getByRole('button', { name: '--confirm', exact: true }).click();
  await expect.poll(() => previews).toBe(1);
  await expect(section(page, 'Preview and ship').locator('.section-meta')).toHaveText('shipgate preview --confirm');

  await page.getByLabel(/Commit message/).fill('Add notes');
  await page.clock.runFor(349);
  await page.waitForTimeout(200);
  expect(previews).toBe(1);
  await page.clock.runFor(1);
  await expect.poll(() => previews).toBe(2);
  await expect(verdict(page)).toContainText('allows this run');
});

test('Ship keeps focus while the preview refreshes and opens once it is current', async ({ page, repo }) => {
  await page.goto(repo.url);
  await enable(page);
  repo.write('notes.md', 'hello\n');
  await page.getByRole('button', { name: 'Refresh' }).click();
  const ship = page.getByRole('button', { name: 'Ship…' });
  await expect(ship).toBeEnabled();
  // Hold each preview response so the refresh is still running when Ship is pressed.
  await page.route('**/api/preview', async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await page.getByLabel(/Commit message/).fill('Add notes');
  await expect(ship).toHaveAttribute('aria-disabled', 'true');
  await ship.focus();
  await page.keyboard.press('Enter');
  await expect(ship).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Ship these changes?' })).toBeHidden();
  const dialog = page.getByRole('dialog', { name: 'Ship these changes?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('$ shipgate ship -m "Add notes"');
  await page.keyboard.press('Escape');
  expect(repo.git('log', '--oneline').split('\n')).toHaveLength(1);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`console text meets WCAG AA contrast in the ${colorScheme} theme`, async ({ page, repo }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    repo.write('.env', `OPENAI_API_KEY=${KEY}\n`);
    await page.goto(repo.url);
    await enable(page);
    await expect(verdict(page)).toContainText('Credential findings');
    const ratios = await contrastRatios(page);
    expect(ratios.length).toBeGreaterThan(30);
    for (const { text, ratio } of ratios) expect(ratio, `${colorScheme}: "${text}"`).toBeGreaterThanOrEqual(4.5);
  });
}

for (const width of [360, 768, 1280]) {
  test(`console fits a ${width}px viewport without horizontal page scrolling`, async ({ page, repo }) => {
    await page.setViewportSize({ width, height: 900 });
    repo.write('a/very/long/path/that/keeps/going/and/going/without/any/breaks/file-name-that-is-long.txt', 'x\n');
    await page.goto(repo.url);
    await expect(section(page, 'Preview and ship').getByRole('region', { name: /Changes/ })).toContainText('file-name-that-is-long.txt');
    const [scrollWidth, innerWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  });
}

test('a long change list scrolls inside its box instead of stretching the page', async ({ page, repo }) => {
  for (let i = 0; i < 300; i += 1) repo.write(`bulk/file-${i}.txt`, `${i}\n`);
  await page.goto(repo.url);
  await expect(section(page, 'Preview and ship').getByRole('region', { name: /Changes/ }).locator('.count')).toHaveText('300');
  const [pageHeight, contentBottom] = await page.evaluate(() => [
    document.documentElement.scrollHeight,
    Math.ceil(document.querySelector('.app')!.getBoundingClientRect().bottom + window.scrollY),
  ]);
  expect(pageHeight).toBeLessThanOrEqual(contentBottom + 2);
});

test.describe('static build', () => {
  test('without shipgate ui, the Repository view explains how to start it', async ({ page }) => {
    await page.goto('./#/repo');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Manage a repository from the browser');
    await expect(page.locator('.connect-empty')).toContainText('shipgate ui');
    await expect(page.locator('.live-dot')).toHaveCount(0);
    await expect(page).toHaveTitle('Repository console · Shipgate');
  });
});

test.describe('accessibility (axe)', () => {
  const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
  type Result = { id: string; nodes: Array<{ target: unknown; any: Array<{ data?: { messageKey?: string } | null }> }> };
  const describe = (results: Result[]) => results.map((r) => `${r.id}: ${r.nodes.map((n) => JSON.stringify(n.target)).join(', ')}`);
  const scan = (page: Page) => new AxeBuilder({ page }).withTags(TAGS).analyze();
  /**
   * axe cannot compute backgrounds in the top layer, so it reports text in an open <dialog>
   * as "partially obscured" (incomplete) rather than measuring it. Those nodes are measured
   * with the contrast helper instead; anything else incomplete fails the test.
   */
  const topLayerContrast = (r: Result) => r.id === 'color-contrast' && r.nodes.every((n) => n.any.some((a) => a.data?.messageKey === 'elmPartiallyObscuring'));

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`#/repo console has no axe violations in the ${colorScheme} theme`, async ({ page, repo }) => {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.goto(repo.url);
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
      await enable(page);
      // A populated page: a result panel with output, a blocking finding, changes, a
      // Shipgate commit in history, and the undo row.
      repo.write('greet.js', 'export const greet = () => 1;\n');
      await page.getByLabel(/Commit message/).fill('Add greet');
      await expect(section(page, 'Preview and ship')).toContainText('Commit subject: Add greet');
      await page.getByRole('button', { name: 'Ship…' }).click();
      await page.getByRole('dialog', { name: 'Ship these changes?' }).getByRole('button', { name: 'Ship', exact: true }).click();
      await expect(page.getByRole('region', { name: /^Done: shipgate ship/ })).toBeVisible();
      repo.write('.env', `OPENAI_API_KEY=${KEY}\n`);
      await page.getByLabel(/Commit message/).fill('');
      await page.getByRole('button', { name: 'Refresh' }).click();
      await expect(verdict(page)).toContainText('Credential findings');
      await expect(section(page, 'History').getByRole('button', { name: 'Undo last ship…' })).toBeVisible();

      const full = await scan(page);
      expect(full.passes.length).toBeGreaterThan(30);
      expect(describe(full.violations), `${colorScheme}: violations`).toEqual([]);
      expect(describe(full.incomplete), `${colorScheme}: needs review`).toEqual([]);

      await section(page, 'History').getByRole('button', { name: 'Undo last ship…' }).click();
      await expect(page.getByRole('dialog', { name: 'Undo the last ship?' })).toBeVisible();
      const open = await scan(page);
      expect(describe(open.violations), `${colorScheme} dialog: violations`).toEqual([]);
      expect(describe(open.incomplete.filter((r) => !topLayerContrast(r))), `${colorScheme} dialog: needs review`).toEqual([]);
      const ratios = await contrastRatios(page, 'dialog[open]');
      expect(ratios.length).toBeGreaterThan(2);
      for (const { text, ratio } of ratios) expect(ratio, `${colorScheme} dialog: "${text}"`).toBeGreaterThanOrEqual(4.5);
    });

    test(`#/repo without shipgate ui has no axe violations in the ${colorScheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.goto('./#/repo');
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Manage a repository from the browser');
      const results = await scan(page);
      expect(results.passes.length).toBeGreaterThan(20);
      expect(describe(results.violations), `${colorScheme}: violations`).toEqual([]);
      expect(describe(results.incomplete), `${colorScheme}: needs review`).toEqual([]);
    });
  }
});

test('confirmation dialogs move, trap, and return focus', async ({ page, repo }) => {
  await page.goto(repo.url);
  await enable(page);
  repo.write('notes.md', 'hello\n');
  await page.getByLabel(/Commit message/).fill('Add notes');
  await expect(section(page, 'Preview and ship')).toContainText('Commit subject: Add notes');
  await expect(page.getByRole('button', { name: 'Ship…' })).toBeEnabled();
  /** The focused element: its button text when it is a button, else its tag, and whether an open dialog contains it. */
  const focused = () => page.evaluate(() => {
    const el = document.activeElement;
    return { inside: Boolean(el?.closest('dialog[open]')), name: el instanceof HTMLButtonElement ? el.textContent!.trim() : el?.tagName ?? null };
  });

  const cases = [
    { trigger: page.getByRole('button', { name: 'Ship…' }), name: 'Ship these changes?', confirm: 'Ship' },
    { trigger: section(page, 'Settings').getByRole('button', { name: 'Disable…' }), name: 'Disable Shipgate here?', confirm: 'Disable' },
    { trigger: card(page, 'Agent hooks').getByRole('button', { name: 'Install hooks…' }), name: 'Install agent hooks?', confirm: 'Install hooks' },
  ];
  for (const { trigger, name, confirm } of cases) {
    // Open from the keyboard, as a keyboard user would.
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name });
    await expect(dialog).toBeVisible();
    // 1. Focus moves into the dialog, onto Cancel.
    expect(await focused(), name).toEqual({ inside: true, name: 'Cancel' });
    // 2. Tab and Shift+Tab cycle between the dialog's two buttons and never leave it.
    const order: string[] = [];
    for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      const now = await focused();
      expect(now.inside, `${name}: ${key} moved focus to ${now.name}`).toBe(true);
      order.push(now.name!);
    }
    expect(order, name).toEqual([confirm, 'Cancel', confirm, 'Cancel', confirm, 'Cancel']);
    // 3. Escape closes it without running the command.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // 4. Focus returns to the button that opened it.
    await expect(trigger).toBeFocused();
  }
  expect(repo.git('log', '--oneline').split('\n')).toHaveLength(1);
  expect(JSON.parse(readFileSync(join(repo.dir, '.shipgate.json'), 'utf8')).enabled).toBe(true);
  expect(existsSync(join(repo.sandbox, 'cursor', 'hooks.json'))).toBe(false);

  // Cancel and a click on the backdrop also return focus to the trigger.
  const ship = page.getByRole('button', { name: 'Ship…' });
  const dialog = page.getByRole('dialog', { name: 'Ship these changes?' });
  await ship.click();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(ship).toBeFocused();
  await ship.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(dialog).toBeHidden();
  await expect(ship).toBeFocused();
  expect(repo.git('log', '--oneline').split('\n')).toHaveLength(1);
});
