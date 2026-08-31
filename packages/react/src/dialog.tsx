import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

export interface DialogProps {
  readonly open: boolean
  readonly busy?: boolean
  readonly role?: 'dialog' | 'alertdialog'
  readonly overlayClassName?: string
  readonly panelClassName?: string
  readonly labelledBy: string
  readonly describedBy?: string
  readonly initialFocusRef?: RefObject<HTMLElement | null>
  readonly portalContainer?: Element
  readonly inertTarget?: HTMLElement | null
  readonly actionSelector?: string
  readonly children: ReactNode
  readonly onClose: () => void
}

const defaultActionSelector =
  '[data-arena-dialog-action]:not([disabled]),button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function Dialog({
  open,
  busy = false,
  role = 'dialog',
  overlayClassName,
  panelClassName,
  labelledBy,
  describedBy,
  initialFocusRef,
  portalContainer,
  inertTarget,
  actionSelector = defaultActionSelector,
  children,
  onClose,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return undefined
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const background = inertTarget === undefined ? document.getElementById('root') : inertTarget
    if (background) background.inert = true
    const frame = window.requestAnimationFrame(() => {
      const fallback = panelRef.current?.querySelector<HTMLElement>(actionSelector)
      ;(initialFocusRef?.current ?? fallback ?? panelRef.current)?.focus()
    })
    return () => {
      window.cancelAnimationFrame(frame)
      if (background) background.inert = false
      previousFocus?.focus()
    }
  }, [actionSelector, inertTarget, initialFocusRef, open])

  if (!open) return null
  const portal = portalContainer ?? document.body
  return createPortal(
    <div
      className={overlayClassName}
      onPointerDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={panelClassName}
        aria-describedby={describedBy}
        aria-labelledby={labelledBy}
        aria-modal="true"
        role={role}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.preventDefault()
            onClose()
            return
          }
          if (event.key !== 'Tab') return
          const controls = panelRef.current?.querySelectorAll<HTMLElement>(actionSelector)
          if (!controls || controls.length === 0) return
          const first = controls[0]!
          const last = controls[controls.length - 1]!
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        {children}
      </div>
    </div>,
    portal,
  )
}

export interface ConfirmDialogClassNames {
  readonly overlay?: string
  readonly panel?: string
  readonly icon?: string
  readonly copy?: string
  readonly actions?: string
  readonly cancelButton?: string
  readonly confirmButton?: string
}

export interface ConfirmDialogProps {
  readonly open: boolean
  readonly title: ReactNode
  readonly description: ReactNode
  readonly cancelLabel: ReactNode
  readonly confirmLabel: ReactNode
  readonly icon?: ReactNode
  readonly busy?: boolean
  readonly classNames?: ConfirmDialogClassNames
  readonly portalContainer?: Element
  readonly inertTarget?: HTMLElement | null
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  cancelLabel,
  confirmLabel,
  icon = null,
  busy = false,
  classNames = {},
  portalContainer,
  inertTarget,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      busy={busy}
      labelledBy={titleId}
      describedBy={descriptionId}
      initialFocusRef={cancelRef}
      open={open}
      role="alertdialog"
      {...(classNames.overlay ? { overlayClassName: classNames.overlay } : {})}
      {...(classNames.panel ? { panelClassName: classNames.panel } : {})}
      {...(portalContainer ? { portalContainer } : {})}
      {...(inertTarget !== undefined ? { inertTarget } : {})}
      onClose={onCancel}
    >
      {icon ? (
        <div className={classNames.icon} aria-hidden>
          {icon}
        </div>
      ) : null}
      <div className={classNames.copy}>
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
      </div>
      <div className={classNames.actions}>
        <button
          ref={cancelRef}
          className={classNames.cancelButton}
          data-arena-dialog-action
          disabled={busy}
          type="button"
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          className={classNames.confirmButton}
          data-arena-dialog-action
          disabled={busy}
          type="button"
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}
