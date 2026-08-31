import { useId, useRef, type ReactNode } from 'react'
import { Dialog } from '@agent-arena/react'
import type {
  SimulationApprovalLike,
  SimulationReviewLike,
  SimulationReviewState,
} from './simulation-review.js'

export interface SimulationWizardClassNames {
  readonly overlay?: string
  readonly panel?: string
  readonly header?: string
  readonly body?: string
  readonly actions?: string
  readonly error?: string
}

export function SimulationReviewWizard<
  Review extends SimulationReviewLike,
  Approval extends SimulationApprovalLike,
>({
  open,
  state,
  title,
  description,
  labels,
  classNames = {},
  renderReview,
  renderApproval,
  renderActivity,
  onClose,
}: {
  readonly open: boolean
  readonly state: SimulationReviewState<Review, Approval>
  readonly title: ReactNode
  readonly description: ReactNode
  readonly labels: {
    readonly cancel: ReactNode
    readonly start: ReactNode
    readonly retry: ReactNode
    readonly approve: ReactNode
    readonly close: ReactNode
  }
  readonly classNames?: SimulationWizardClassNames
  readonly renderReview: (
    review: Review,
    state: SimulationReviewState<Review, Approval>,
  ) => ReactNode
  readonly renderApproval: (approval: Approval) => ReactNode
  readonly renderActivity: (stage: 'reviewing' | 'approving') => ReactNode
  readonly onClose: () => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      busy={state.busy}
      labelledBy={titleId}
      describedBy={descriptionId}
      initialFocusRef={cancelRef}
      open={open}
      {...(classNames.overlay ? { overlayClassName: classNames.overlay } : {})}
      {...(classNames.panel ? { panelClassName: classNames.panel } : {})}
      onClose={onClose}
    >
      <header className={classNames.header}>
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
      </header>
      <div className={classNames.body}>
        {state.stage === 'reviewing' || state.stage === 'approving'
          ? renderActivity(state.stage)
          : null}
        {state.stage === 'review' && state.review ? renderReview(state.review, state) : null}
        {state.stage === 'complete' && state.approval ? renderApproval(state.approval) : null}
        {state.error ? (
          <p className={classNames.error} role="alert">
            {state.error.message}
          </p>
        ) : null}
      </div>
      <footer className={classNames.actions}>
        {state.stage === 'prepare' ? (
          <>
            <button ref={cancelRef} data-arena-dialog-action type="button" onClick={onClose}>
              {labels.cancel}
            </button>
            <button data-arena-dialog-action type="button" onClick={() => void state.runReview()}>
              {labels.start}
            </button>
          </>
        ) : null}
        {state.stage === 'review' ? (
          <>
            <button ref={cancelRef} data-arena-dialog-action type="button" onClick={onClose}>
              {labels.cancel}
            </button>
            <button data-arena-dialog-action type="button" onClick={() => void state.runReview()}>
              {labels.retry}
            </button>
            <button
              data-arena-dialog-action
              disabled={!state.canSubmit}
              type="button"
              onClick={() => void state.approve()}
            >
              {labels.approve}
            </button>
          </>
        ) : null}
        {state.stage === 'complete' ? (
          <button ref={cancelRef} data-arena-dialog-action type="button" onClick={onClose}>
            {labels.close}
          </button>
        ) : null}
        {state.busy ? (
          <button data-arena-dialog-action disabled type="button">
            {state.stage}
          </button>
        ) : null}
      </footer>
    </Dialog>
  )
}
