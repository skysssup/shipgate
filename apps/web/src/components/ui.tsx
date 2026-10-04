import * as RadioGroup from '@radix-ui/react-radio-group';
import * as Select from '@radix-ui/react-select';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { PlanAction } from '@shipgate/core/browser';
import { Ban, Check, ChevronDown, CircleMinus, CirclePause, Copy, Plus, type LucideIcon } from 'lucide-react';
import { Fragment, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';
import { ACTION_LABEL } from '../lib/model';

export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'secondary' | 'ghost';
  size?: 'sm' | 'md';
};

export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)} {...props} />;
}

export function Tip({ label, children, side = 'bottom' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" side={side} sideOffset={6} collisionPadding={12}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** Icon-only button with an accessible name that is also shown as a tooltip. */
export function IconButton({ label, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <Tip label={label}>
      <button type="button" aria-label={label} className={cx('icon-btn', className)} {...props}>
        {children}
      </button>
    </Tip>
  );
}

const ACTION_ICON: Record<PlanAction, LucideIcon> = { ship: Check, hold: CirclePause, block: Ban, noop: CircleMinus };

export function ActionIcon({ action, size = 18 }: { action: PlanAction; size?: number }) {
  const Icon = ACTION_ICON[action];
  return <Icon size={size} strokeWidth={2.25} aria-hidden />;
}

export function ActionBadge({ action }: { action: PlanAction }) {
  return (
    <span className={cx('badge', `tone-${action}`)}>
      <ActionIcon action={action} size={11} />
      {ACTION_LABEL[action]}
    </span>
  );
}

/** Icon button that copies text and confirms in its label. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1800);
  };
  return (
    <IconButton label={state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed: select the text instead' : label} onClick={copy} className="copy-btn" data-state={state}>
      {state === 'copied' ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
    </IconButton>
  );
}

/** Renders `code` spans written with backticks. */
export function InlineCode({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

/** A titled region. The heading level follows the page outline. */
export function Section({
  title,
  meta,
  actions,
  children,
  className,
  id,
  level = 2,
  hideTitle = false,
  ref,
}: {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  level?: 2 | 3;
  hideTitle?: boolean;
  ref?: Ref<HTMLElement>;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  const headingId = useId();
  return (
    <section className={cx('section', className)} aria-labelledby={headingId} id={id} ref={ref} tabIndex={ref ? -1 : undefined}>
      <header className={cx('section-head', hideTitle && 'sr-only')}>
        <Heading className="section-title" id={headingId}>
          {title}
        </Heading>
        {meta && <span className="section-meta">{meta}</span>}
        {actions && <div className="section-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/** A command-line flag that can be switched on and off. */
export function FlagToken({
  flag,
  pressed,
  onChange,
  description,
  cause,
  id,
}: {
  flag: string;
  pressed: boolean;
  onChange: (pressed: boolean) => void;
  description: string;
  cause?: 'stop' | 'warn';
  id?: string;
}) {
  const hintId = useId();
  return (
    <>
      <Tip label={description}>
        <button
          type="button"
          id={id}
          className="token token-flag"
          aria-pressed={pressed}
          aria-describedby={hintId}
          data-cause={cause}
          onClick={() => onChange(!pressed)}
        >
          <span className="token-mark" aria-hidden>
            {pressed ? <Check size={11} strokeWidth={3} /> : <Plus size={11} strokeWidth={3} />}
          </span>
          {flag}
        </button>
      </Tip>
      <span id={hintId} className="sr-only">
        {description}
      </span>
    </>
  );
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  hint?: string;
  icon?: LucideIcon;
}

/** Mutually exclusive values for one flag, such as --level. Arrow keys move between them. */
export function TokenChoice<T extends string>({
  label,
  value,
  options,
  onChange,
  describedBy,
}: {
  label: string;
  value: T;
  options: Array<Choice<T>>;
  onChange: (value: T) => void;
  describedBy?: string;
}) {
  return (
    <RadioGroup.Root
      className="token-choice"
      value={value}
      onValueChange={(v) => onChange(v as T)}
      aria-label={label}
      aria-describedby={describedBy}
      orientation="horizontal"
      loop
    >
      {options.map((option) => (
        <RadioGroup.Item key={option.value} value={option.value} className="token-choice-item">
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

function SelectItems<T extends string>({ options }: { options: Array<Choice<T>> }) {
  return (
    <Select.Portal>
      <Select.Content className="select-content" position="popper" sideOffset={6} collisionPadding={12}>
        <Select.Viewport className="select-viewport">
          {options.map(({ value, label, hint, icon: Icon }) => (
            <Select.Item key={value} value={value} className="select-item">
              {Icon && <Icon size={14} aria-hidden className="select-item-icon" />}
              <span className="select-item-text">
                <Select.ItemText>{label}</Select.ItemText>
                {hint && <span className="select-item-hint">{hint}</span>}
              </span>
              <Select.ItemIndicator className="select-item-check">
                <Check size={14} aria-hidden />
              </Select.ItemIndicator>
            </Select.Item>
          ))}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  );
}

/** A repository fact shown as a compact chip that opens a menu of values. */
export function FactSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  cause,
  id,
  description,
}: {
  label: string;
  value: T;
  options: Array<Choice<T>>;
  onChange: (value: T) => void;
  cause?: 'stop' | 'warn';
  id: string;
  description: string;
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  const Icon = current.icon;
  return (
    <div className="fact" data-cause={cause}>
      <span className="fact-label" id={`${id}-label`} title={description}>
        {label}
      </span>
      <Select.Root value={value} onValueChange={(v) => onChange(v as T)}>
        <Select.Trigger id={id} className="fact-trigger" aria-labelledby={`${id}-label`} aria-describedby={`${id}-hint`}>
          {Icon && <Icon size={14} aria-hidden className="fact-icon" />}
          <Select.Value />
          <ChevronDown size={13} aria-hidden className="fact-chevron" />
        </Select.Trigger>
        <SelectItems options={options} />
      </Select.Root>
      <span id={`${id}-hint`} className="sr-only">
        {description}
      </span>
    </div>
  );
}
