import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cx } from '../components/ui';

/**
 * A modal confirmation built on <dialog>: the browser makes the page inert and closes on
 * Escape. Focus starts on Cancel so Enter never confirms by accident. Tab and Shift+Tab wrap
 * between the dialog's controls (browsers otherwise let focus leave for the browser UI, or
 * stop on the dialog element itself).
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || !ref.current) return;
        const controls = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
        if (!controls.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === ref.current)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || active === ref.current)) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div className="dialog-body">
        <h2 className="dialog-title" id={titleId}>
          {title}
        </h2>
        <div className="dialog-text" id={bodyId}>
          {children}
        </div>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={cx('btn', danger ? 'btn-danger' : 'btn-primary')} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
