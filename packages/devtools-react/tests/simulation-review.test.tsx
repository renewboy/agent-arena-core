// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimulationReviewWizard, useSimulationReview } from '../src/index.js'

interface Review {
  readonly simulationId: string
  readonly canApprove: boolean
  readonly canAcceptCurrent: boolean
  readonly warnings: readonly string[]
  readonly secretWarnings: readonly string[]
  readonly failures: readonly string[]
}

interface Approval {
  readonly simulationId: string
  readonly created: boolean
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => cleanup())

describe('useSimulationReview', () => {
  it('reviews, gates warnings/current behavior, approves, and resets by target', async () => {
    const source = {
      review: vi.fn(
        async (): Promise<Review> => ({
          simulationId: 'simulation-one',
          canApprove: false,
          canAcceptCurrent: true,
          warnings: ['warning'],
          secretWarnings: [],
          failures: [],
        }),
      ),
      approve: vi.fn(
        async (): Promise<Approval> => ({
          simulationId: 'simulation-one',
          created: true,
        }),
      ),
    }
    const hook = renderHook(
      ({ key }) => useSimulationReview({ target: { id: key }, targetKey: key, dataSource: source }),
      { initialProps: { key: 'one' } },
    )
    await act(async () => hook.result.current.runReview())
    expect(hook.result.current.stage).toBe('review')
    expect(hook.result.current.canSubmit).toBe(false)
    act(() => {
      hook.result.current.setAcknowledgeWarnings(true)
      hook.result.current.setAcceptCurrent(true)
    })
    expect(hook.result.current.canSubmit).toBe(true)
    await act(async () => hook.result.current.approve())
    expect(source.approve).toHaveBeenCalledWith('simulation-one', {
      acknowledgeWarnings: true,
      acceptCurrent: true,
    })
    expect(hook.result.current.stage).toBe('complete')
    hook.rerender({ key: 'two' })
    expect(hook.result.current.stage).toBe('prepare')
  })

  it('blocks secrets and reports review/approval failures', async () => {
    const source = {
      review: vi
        .fn<() => Promise<Review>>()
        .mockRejectedValueOnce('review failed')
        .mockResolvedValue({
          simulationId: 'simulation-one',
          canApprove: true,
          canAcceptCurrent: false,
          warnings: [],
          secretWarnings: ['secret'],
          failures: [],
        }),
      approve: vi.fn(async () => {
        throw new Error('approve failed')
      }),
    }
    const hook = renderHook(() =>
      useSimulationReview({ target: 'match', targetKey: 'match', dataSource: source }),
    )
    await act(async () => hook.result.current.runReview())
    expect(hook.result.current.error?.message).toBe('review failed')
    await act(async () => hook.result.current.runReview())
    expect(hook.result.current.canSubmit).toBe(false)
    act(() => {
      if (hook.result.current.review) hook.result.current.setAcceptCurrent(true)
    })
    await act(async () => hook.result.current.approve())
    expect(hook.result.current.error?.message).toBe('approve failed')
    expect(hook.result.current.stage).toBe('review')

    const absent = renderHook(() =>
      useSimulationReview({ target: null, targetKey: null, dataSource: source }),
    )
    await act(async () => absent.result.current.runReview())
    expect(absent.result.current.stage).toBe('prepare')
    await act(async () => absent.result.current.approve())
  })
})

describe('SimulationReviewWizard', () => {
  it('renders prepare, review, busy, and complete actions through slots', async () => {
    const user = userEvent.setup()
    const close = vi.fn()
    const source = {
      review: vi.fn(
        async (): Promise<Review> => ({
          simulationId: 'simulation-one',
          canApprove: true,
          canAcceptCurrent: false,
          warnings: [],
          secretWarnings: [],
          failures: [],
        }),
      ),
      approve: vi.fn(
        async (): Promise<Approval> => ({
          simulationId: 'simulation-one',
          created: true,
        }),
      ),
    }
    function Harness() {
      const state = useSimulationReview({ target: 'match', targetKey: 'match', dataSource: source })
      return (
        <SimulationReviewWizard
          labels={{
            cancel: 'Cancel',
            start: 'Start',
            retry: 'Retry',
            approve: 'Approve',
            close: 'Close',
          }}
          open
          state={state}
          title="Simulation"
          description="Review"
          renderActivity={(stage) => <span>{stage}</span>}
          renderApproval={(approval) => <span>{approval.simulationId}</span>}
          renderReview={(review) => <span>{review.simulationId}</span>}
          onClose={close}
        />
      )
    }
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByText('simulation-one')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(source.review).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(close).toHaveBeenCalledOnce()
  })
})
