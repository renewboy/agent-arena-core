import { useCallback, useEffect, useRef, useState } from 'react'
import type { SimulationApprovalRequest } from '@agent-arena/simulation'

export type SimulationReviewStage = 'prepare' | 'reviewing' | 'review' | 'approving' | 'complete'

export interface SimulationReviewLike {
  readonly simulationId: string
  readonly canApprove: boolean
  readonly canAcceptCurrent: boolean
  readonly warnings: readonly string[]
  readonly secretWarnings: readonly string[]
  readonly failures: readonly string[]
}

export interface SimulationApprovalLike {
  readonly simulationId: string
}

export interface SimulationReviewDataSource<Target, Review, Approval> {
  review(target: Target): Promise<Review>
  approve(simulationId: string, options: SimulationApprovalRequest): Promise<Approval>
}

export interface SimulationReviewState<Review, Approval> {
  readonly stage: SimulationReviewStage
  readonly review: Review | null
  readonly approval: Approval | null
  readonly error: Error | null
  readonly acknowledgeWarnings: boolean
  readonly acceptCurrent: boolean
  readonly busy: boolean
  readonly warningReady: boolean
  readonly behaviorReady: boolean
  readonly canSubmit: boolean
  readonly runReview: () => Promise<void>
  readonly approve: () => Promise<void>
  readonly setAcknowledgeWarnings: (value: boolean) => void
  readonly setAcceptCurrent: (value: boolean) => void
  readonly reset: () => void
}

export function useSimulationReview<
  Target,
  Review extends SimulationReviewLike,
  Approval extends SimulationApprovalLike,
>({
  target,
  targetKey,
  dataSource,
}: {
  readonly target: Target | null
  readonly targetKey: string | null
  readonly dataSource: SimulationReviewDataSource<Target, Review, Approval>
}): SimulationReviewState<Review, Approval> {
  const [stage, setStage] = useState<SimulationReviewStage>('prepare')
  const [review, setReview] = useState<Review | null>(null)
  const [approval, setApproval] = useState<Approval | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false)
  const [acceptCurrent, setAcceptCurrent] = useState(false)
  const generation = useRef(0)

  const reset = useCallback(() => {
    generation.current += 1
    setStage('prepare')
    setReview(null)
    setApproval(null)
    setError(null)
    setAcknowledgeWarnings(false)
    setAcceptCurrent(false)
  }, [])

  useEffect(() => reset(), [reset, targetKey])

  const runReview = useCallback(async (): Promise<void> => {
    if (target === null) return
    const current = ++generation.current
    setStage('reviewing')
    setReview(null)
    setApproval(null)
    setError(null)
    setAcknowledgeWarnings(false)
    setAcceptCurrent(false)
    try {
      const value = await dataSource.review(target)
      if (generation.current !== current) return
      setReview(value)
      setStage('review')
    } catch (cause) {
      if (generation.current !== current) return
      setError(normalizeError(cause))
      setStage('prepare')
    }
  }, [dataSource, target])

  const approve = useCallback(async (): Promise<void> => {
    if (!review) return
    const current = ++generation.current
    setStage('approving')
    setError(null)
    try {
      const value = await dataSource.approve(review.simulationId, {
        acceptCurrent,
        acknowledgeWarnings,
      })
      if (generation.current !== current) return
      setApproval(value)
      setStage('complete')
    } catch (cause) {
      if (generation.current !== current) return
      setError(normalizeError(cause))
      setStage('review')
    }
  }, [acceptCurrent, acknowledgeWarnings, dataSource, review])

  const busy = stage === 'reviewing' || stage === 'approving'
  const warningReady = !review?.warnings.length || acknowledgeWarnings
  const behaviorReady = Boolean(review?.canApprove || (acceptCurrent && review?.canAcceptCurrent))
  const canSubmit = Boolean(
    review && warningReady && behaviorReady && review.secretWarnings.length === 0,
  )
  return {
    stage,
    review,
    approval,
    error,
    acknowledgeWarnings,
    acceptCurrent,
    busy,
    warningReady,
    behaviorReady,
    canSubmit,
    runReview,
    approve,
    setAcknowledgeWarnings,
    setAcceptCurrent,
    reset,
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
