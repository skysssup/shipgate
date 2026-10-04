import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import { Check, Link2, Monitor, Moon, Sun, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { View } from '../lib/route';
import type { ThemePreference } from '../lib/theme';
import { CopyButton, cx, Tip } from './ui';

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="logo">
      <rect width="24" height="24" rx="6" className="logo-bg" />
      <path d="M7 5.5v13M17 5.5v13M7 9h10" className="logo-gate" />
      <path d="M9.6 13.6l1.9 1.9 3.2-3.6" className="logo-check" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const THEMES: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

function ThemeMenu({ theme, onTheme }: { theme: ThemePreference; onTheme: (theme: ThemePreference) => void }) {
  const Current = THEMES.find((t) => t.value === theme)!.icon;
  return (
    <DropdownMenu.Root>
      <Tip label="Theme">
        <DropdownMenu.Trigger className="icon-btn" aria-label={`Theme: ${theme}`}>
          <Current size={16} aria-hidden />
        </DropdownMenu.Trigger>
      </Tip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align="end" sideOffset={6} collisionPadding={12}>
          <DropdownMenu.Label className="menu-label">Theme</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={theme} onValueChange={(value) => onTheme(value as ThemePreference)}>
            {THEMES.map(({ value, label, icon: Icon }) => (
              <DropdownMenu.RadioItem key={value} value={value} className="menu-item">
                <Icon size={14} aria-hidden />
                {label}
                <DropdownMenu.ItemIndicator className="menu-check">
                  <Check size={14} aria-hidden />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function SharePopover({ unsharedEdits }: { unsharedEdits: boolean }) {
  const [url, setUrl] = useState('');
  return (
    <Popover.Root onOpenChange={(open) => open && setUrl(location.href)}>
      <Popover.Trigger className="btn btn-secondary btn-sm share-btn">
        <Link2 size={14} aria-hidden />
        Share
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover share-popover" align="end" sideOffset={8} collisionPadding={12}>
          <h2 className="popover-title">Link to this setup</h2>
          <div className="share-row">
            <label className="sr-only" htmlFor="share-url">
              Link
            </label>
            <input id="share-url" className="input mono" readOnly value={url} onFocus={(event) => event.target.select()} />
            <CopyButton text={url} label="Copy link" />
          </div>
          <p className="popover-text">The link stores the example, level, and settings. File contents and typed text stay on this device.</p>
          {unsharedEdits && (
            <p className="popover-text popover-warning">
              <TriangleAlert size={13} aria-hidden />
              Your edits to files or text are not in the link.
            </p>
          )}
          <Popover.Arrow className="popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function Header({
  view,
  simulatorHref,
  theme,
  onTheme,
  version,
  unsharedEdits,
}: {
  view: View;
  simulatorHref: string;
  theme: ThemePreference;
  onTheme: (theme: ThemePreference) => void;
  version: string;
  unsharedEdits: boolean;
}) {
  const links: Array<{ view: View; href: string; label: string }> = [
    { view: 'simulator', href: simulatorHref, label: 'Simulator' },
    { view: 'rules', href: '#/rules', label: 'Rules' },
    { view: 'start', href: '#/start', label: 'Get started' },
  ];
  return (
    <header className="topbar">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <a className="brand" href={simulatorHref} aria-label="Shipgate policy simulator">
        <Logo />
        <span className="brand-name">Shipgate</span>
      </a>
      <nav className="topnav" aria-label="Sections">
        {links.map((link) => (
          <a key={link.view} href={link.href} className={cx('topnav-link', view === link.view && 'is-active')} aria-current={view === link.view ? 'page' : undefined}>
            {link.label}
          </a>
        ))}
      </nav>
      <div className="topbar-actions">
        <span className="version" title="Simulator version">
          v{version}
        </span>
        {view === 'simulator' && <SharePopover unsharedEdits={unsharedEdits} />}
        <ThemeMenu theme={theme} onTheme={onTheme} />
        <Tip label="Shipgate on GitHub">
          <a className="icon-btn" href="https://github.com/skysssup/shipgate" target="_blank" rel="noreferrer" aria-label="Shipgate on GitHub">
            <GitHubMark />
          </a>
        </Tip>
      </div>
    </header>
  );
}
