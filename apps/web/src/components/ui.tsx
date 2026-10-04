import * as Popover from '@radix-ui/react-popover';
import * as RadioGroup from '@radix-ui/react-radio-group';
import * as Select from '@radix-ui/react-select';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { PlanAction } from '@shipgate/core/browser';
import { Ban, Check, ChevronDown, CircleMinus, CirclePause, Copy, Info } from 'lucide-react';
import { Fragment, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
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

export function Tip({ label, children, side = 'bottom' }: { label: string; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" side={side} sideOffset={6}>
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

/** Small "i" button that opens an explanation. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger className="info-btn" aria-label={label}>
        <Info size={14} aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover info-popover" sideOffset={6} collisionPadding={12}>
          {children}
          <Popover.Arrow className="popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function Switch({
  label,
  description,
  checked,
  onChange,
  info,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  info?: ReactNode;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="field switch-field">
      <div className="switch-row">
        <div className="field-text">
          <span className="field-label-line">
            <label className="field-label" htmlFor={id}>
              {label}
            </label>
            {info}
          </span>
          {description && (
            <span className="field-hint" id={`${id}-hint`}>
              {description}
            </span>
          )}
        </div>
        <SwitchPrimitive.Root
          id={id}
          className="switch"
          checked={checked}
          onCheckedChange={onChange}
          aria-describedby={description ? `${id}-hint` : undefined}
        >
          <SwitchPrimitive.Thumb className="switch-thumb" />
        </SwitchPrimitive.Root>
      </div>
      {children}
    </div>
  );
}

export interface Choice<T extends string> {
  value: T;
  label: ReactNode;
  hint?: string;
}

/** Segmented radio group. Arrow keys move between options. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  describedBy,
}: {
  label: string;
  value: T;
  options: Array<Choice<T>>;
  onChange: (value: T) => void;
  className?: string;
  describedBy?: string;
}) {
  return (
    <RadioGroup.Root
      className={cx('segmented', className)}
      value={value}
      onValueChange={(v) => onChange(v as T)}
      aria-label={label}
      aria-describedby={describedBy}
      orientation="horizontal"
      loop
    >
      {options.map((option) => (
        <RadioGroup.Item key={option.value} value={option.value} className="segmented-item" title={option.hint}>
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  info,
  hint,
}: {
  label: string;
  value: T;
  options: Array<Choice<T>>;
  onChange: (value: T) => void;
  info?: ReactNode;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <span className="field-label-line">
        <label className="field-label" htmlFor={id} id={`${id}-label`}>
          {label}
        </label>
        {info}
      </span>
      <Select.Root value={value} onValueChange={(v) => onChange(v as T)}>
        <Select.Trigger id={id} className="select-trigger" aria-labelledby={`${id}-label`} aria-describedby={hint ? `${id}-hint` : undefined}>
          <Select.Value />
          <Select.Icon className="select-icon">
            <ChevronDown size={14} aria-hidden />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="select-content" position="popper" sideOffset={4} collisionPadding={12}>
            <Select.Viewport className="select-viewport">
              {options.map((option) => (
                <Select.Item key={option.value} value={option.value} className="select-item">
                  <Select.ItemText>{option.label}</Select.ItemText>
                  {option.hint && <span className="select-item-hint">{option.hint}</span>}
                  <Select.ItemIndicator className="select-item-check">
                    <Check size={14} aria-hidden />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      {hint && (
        <span className="field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}

const ACTION_ICON: Record<PlanAction, typeof Check> = { ship: Check, hold: CirclePause, block: Ban, noop: CircleMinus };

export function ActionBadge({ action, size = 'md' }: { action: PlanAction; size?: 'sm' | 'md' }) {
  const Icon = ACTION_ICON[action];
  return (
    <span className={cx('badge', `tone-${action}`, size === 'sm' && 'badge-sm')}>
      <Icon size={size === 'sm' ? 11 : 13} strokeWidth={2.5} aria-hidden />
      {ACTION_LABEL[action]}
    </span>
  );
}

export function ActionIcon({ action, size = 18 }: { action: PlanAction; size?: number }) {
  const Icon = ACTION_ICON[action];
  return <Icon size={size} strokeWidth={2.25} aria-hidden />;
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

export function Panel({
  title,
  icon,
  actions,
  children,
  className,
  id,
  headingLevel = 2,
}: {
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const headingId = useId();
  return (
    <section className={cx('panel', className)} aria-labelledby={headingId} id={id}>
      <header className="panel-header">
        <Heading className="panel-title" id={headingId}>
          {icon}
          {title}
        </Heading>
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
