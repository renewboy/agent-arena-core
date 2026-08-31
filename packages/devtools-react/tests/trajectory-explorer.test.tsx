// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  mergeTrajectoryBy,
  useTrajectoryExplorer,
  type TrajectoryDataSource,
} from '../src/index.js'

interface Turn {
  readonly matchId: string
  readonly turnId: string
  readonly ownerId: string
  readonly status: 'completed'
  readonly startedAt: string
  readonly completedAt: string
  readonly durationMs: number
  readonly stopReason: null
  readonly error: null
  readonly usage: null
  readonly ordinal: number
}

interface RecordValue {
  readonly matchId: string
  readonly recordId: string
  readonly turnId: string
  readonly ownerId: string
  readonly kind: 'message'
  readonly title: string
  readonly status: null
  readonly text: string
  readonly input: null
  readonly output: null
  readonly startedAt: string
  readonly truncatedFields: readonly []
  readonly ordinal: number
  readonly durationMs: number
}

interface Owner {
  readonly ownerId: string
  readonly turnCount: number
  readonly recordCount: number
}

interface Summary {
  readonly revision: number
  readonly owners: readonly Owner[]
  readonly turns: readonly Turn[]
}

interface Page {
  readonly revision: number
  readonly ownerId: string
  readonly turns: readonly Turn[]
  readonly records: readonly RecordValue[]
  readonly nextBeforeTurn: number | null
}

afterEach(() => cleanup())

describe('useTrajectoryExplorer', () => {
  it('loads a complete initial owner history before subscribing to live deltas', async () => {
    const calls: Array<number | null> = []
    const subscribe = vi.fn(() => () => undefined)
    const source: TrajectoryDataSource<Turn, RecordValue, Owner, Summary, Page> = {
      loadSummary: async () => ({
        revision: 2,
        owners: [{ ownerId: 'one', turnCount: 3, recordCount: 3 }],
        turns: [turn('one', 1), turn('one', 2), turn('one', 3)],
      }),
      loadPage: async (_resource, ownerId, before) => {
        calls.push(before)
        if (before === 2) return page(ownerId, 1, [turn(ownerId, 1)], [record(ownerId, 1)], null)
        if (calls.filter((value) => value === null).length > 1) {
          return page(
            ownerId,
            3,
            [turn(ownerId, 2), turn(ownerId, 3)],
            [record(ownerId, 2), record(ownerId, 3)],
            2,
          )
        }
        return page(ownerId, 2, [turn(ownerId, 2)], [record(ownerId, 2)], 2)
      },
      subscribe,
    }
    const ownerOne = (): string => 'one'
    const hook = renderHook(() =>
      useTrajectoryExplorer({
        resourceId: 'match',
        dataSource: source,
        initialOwner: ownerOne,
        initialPageMode: 'complete',
      }),
    )
    await waitFor(() => expect(hook.result.current.page?.revision).toBe(3))
    expect(calls).toEqual([null, 2, null])
    expect(hook.result.current.page?.records.map((value) => value.ordinal)).toEqual([1, 2, 3])
    expect(hook.result.current.page?.nextBeforeTurn).toBeNull()
    expect(subscribe).toHaveBeenCalledWith('match', 3, expect.any(Function), expect.any(Function))
    const callCount = calls.length
    act(() => hook.result.current.focus('one', 2, 'record-one-1'))
    expect(hook.result.current.selectedId).toBe('record-one-1')
    expect(calls).toHaveLength(callCount)
    act(() => hook.result.current.focus('two', 2, 'record-two-1'))
    await waitFor(() => expect(hook.result.current.page?.ownerId).toBe('two'))
    expect(calls[callCount]).toBeNull()
    expect(hook.result.current.selectedId).toBe('record-two-1')
  })

  it('completes a one-page initial history without refreshing the head', async () => {
    const loadPage = vi.fn(async (_resource: string, ownerId: string) =>
      page(ownerId, 1, [turn(ownerId, 1)], [record(ownerId, 1)], null),
    )
    const source: TrajectoryDataSource<Turn, RecordValue, Owner, Summary, Page> = {
      loadSummary: async () => ({
        revision: 1,
        owners: [{ ownerId: 'one', turnCount: 1, recordCount: 1 }],
        turns: [turn('one', 1)],
      }),
      loadPage,
    }
    const ownerOne = (): string => 'one'
    const hook = renderHook(() =>
      useTrajectoryExplorer({
        resourceId: 'match',
        dataSource: source,
        initialOwner: ownerOne,
        initialPageMode: 'complete',
      }),
    )
    await waitFor(() => expect(hook.result.current.page?.ownerId).toBe('one'))
    expect(loadPage).toHaveBeenCalledOnce()
  })

  it('loads summary/page, merges deltas, switches owners, focuses, and pages backward', async () => {
    const delta = {
      current: null as
        | null
        | ((value: { revision: number; turns: Turn[]; records: RecordValue[] }) => void),
    }
    let publishError: ((error: unknown) => void) | null = null
    const pages = new Map<string, Page>([
      ['one:null', page('one', 2, [turn('one', 2)], [record('one', 2)], 2)],
      ['one:2', page('one', 1, [turn('one', 1)], [record('one', 1)], null)],
      ['two:null', page('two', 2, [turn('two', 1)], [record('two', 1)], null)],
      ['two:5', page('two', 2, [turn('two', 1)], [record('two', 1)], null)],
    ])
    const loadSummary = vi.fn(async () => ({
      revision: 2,
      owners: [
        { ownerId: 'one', turnCount: 2, recordCount: 2 },
        { ownerId: 'two', turnCount: 1, recordCount: 1 },
      ],
      turns: [turn('one', 2)],
    }))
    const source: TrajectoryDataSource<Turn, RecordValue, Owner, Summary, Page> = {
      loadSummary,
      loadPage: vi.fn(async (_resource, owner, before) => pages.get(`${owner}:${before}`)!),
      subscribe: (_resource, _revision, onDelta, onError) => {
        delta.current = onDelta
        publishError = onError
        return vi.fn()
      },
    }
    const initialOwner = (summary: Summary): string | null => summary.owners[0]?.ownerId ?? null
    const hook = renderHook(() =>
      useTrajectoryExplorer({ resourceId: 'match', dataSource: source, initialOwner }),
    )
    await waitFor(() => expect(hook.result.current.page?.ownerId).toBe('one'))
    act(() => hook.result.current.setQuery('needle'))
    act(() => hook.result.current.select('record-one-2'))
    expect(hook.result.current.query).toBe('needle')
    expect(hook.result.current.selectedId).toBe('record-one-2')

    act(() =>
      delta.current?.({
        revision: 3,
        turns: [turn('one', 3), turn('two', 2)],
        records: [record('one', 3), record('two', 2)],
      }),
    )
    expect(hook.result.current.summary?.revision).toBe(3)
    expect(
      hook.result.current.page?.records.some((value) => value.recordId === 'record-one-3'),
    ).toBe(true)
    act(() => publishError?.('delta failed'))
    expect(hook.result.current.error?.message).toBe('delta failed')

    await act(async () => hook.result.current.loadOlder())
    expect(hook.result.current.page?.turns.map((value) => value.ordinal)).toEqual([1, 2, 3])

    act(() => hook.result.current.selectOwner('two'))
    expect(hook.result.current.page).toBeNull()
    await waitFor(() => expect(hook.result.current.page?.ownerId).toBe('two'))
    act(() => hook.result.current.focus('two', 5, 'record-two-1'))
    await waitFor(() => expect(hook.result.current.selectedId).toBe('record-two-1'))
    act(() => hook.result.current.reload())
    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(2))
  })

  it('reports unavailable, summary, page, delta, and older-page failures', async () => {
    const noOwner = (): null => null
    const unavailableSource = failingSource()
    const unavailable = renderHook(() =>
      useTrajectoryExplorer({
        resourceId: null,
        dataSource: unavailableSource,
        initialOwner: noOwner,
      }),
    )
    await waitFor(() => expect(unavailable.result.current.error?.message).toContain('unavailable'))

    const summarySource = failingSource('summary')
    const summaryFailure = renderHook(() =>
      useTrajectoryExplorer({
        resourceId: 'match',
        dataSource: summarySource,
        initialOwner: noOwner,
      }),
    )
    await waitFor(() => expect(summaryFailure.result.current.error?.message).toBe('summary'))

    let deltaError: ((error: unknown) => void) | null = null
    const source = failingSource('page')
    source.loadSummary = async () => ({
      revision: 1,
      owners: [{ ownerId: 'one', turnCount: 1, recordCount: 1 }],
      turns: [],
    })
    source.subscribe = (_resource, _revision, _delta, onError) => {
      deltaError = onError
      return () => undefined
    }
    const ownerOne = (): string => 'one'
    const pageFailure = renderHook(() =>
      useTrajectoryExplorer({ resourceId: 'match', dataSource: source, initialOwner: ownerOne }),
    )
    await waitFor(() => expect(pageFailure.result.current.error?.message).toBe('page'))
    expect(deltaError).toBeNull()
  })

  it('ignores aborted summary loads, supports an empty owner set, and reports older-page failure', async () => {
    const summaries: Array<(summary: Summary) => void> = []
    const source: TrajectoryDataSource<Turn, RecordValue, Owner, Summary, Page> = {
      loadSummary: () => new Promise((resolve) => summaries.push(resolve)),
      loadPage: async () => page('one', 1, [], [], null),
    }
    const noOwner = (): null => null
    const hook = renderHook(
      ({ resourceId }) =>
        useTrajectoryExplorer({ resourceId, dataSource: source, initialOwner: noOwner }),
      { initialProps: { resourceId: 'first' } },
    )
    hook.rerender({ resourceId: 'second' })
    await act(async () => summaries[0]!({ revision: 1, owners: [], turns: [] }))
    expect(hook.result.current.summary).toBeNull()
    await act(async () => summaries[1]!({ revision: 1, owners: [], turns: [] }))
    await waitFor(() => expect(hook.result.current.summary?.revision).toBe(1))
    expect(hook.result.current.ownerId).toBeNull()
    await act(async () => hook.result.current.loadOlder())

    let pageCalls = 0
    const olderFailure: TrajectoryDataSource<Turn, RecordValue, Owner, Summary, Page> = {
      loadSummary: async () => ({
        revision: 1,
        owners: [{ ownerId: 'one', turnCount: 1, recordCount: 1 }],
        turns: [],
      }),
      loadPage: async () => {
        pageCalls += 1
        if (pageCalls > 1) throw 'older failed'
        return page('one', 1, [turn('one', 1)], [record('one', 1)], 2)
      },
    }
    const ownerOne = (): string => 'one'
    const older = renderHook(() =>
      useTrajectoryExplorer({
        resourceId: 'match',
        dataSource: olderFailure,
        initialOwner: ownerOne,
      }),
    )
    await waitFor(() => expect(older.result.current.page?.nextBeforeTurn).toBe(2))
    await act(async () => older.result.current.loadOlder())
    expect(older.result.current.error?.message).toBe('older failed')

    expect(
      mergeTrajectoryBy([{ id: 'one', value: 1 }], [{ id: 'one', value: 2 }], (item) => item.id),
    ).toEqual([{ id: 'one', value: 2 }])
  })

  it('subscribes to deltas only after the first owner page is complete', async () => {
    let publish:
      | ((delta: { revision: number; turns: Turn[]; records: RecordValue[] }) => void)
      | null = null
    let resolvePage: ((page: Page) => void) | null = null
    const source: TrajectoryDataSource<Turn, RecordValue, Owner, Summary, Page> = {
      loadSummary: async () => ({
        revision: 1,
        owners: [{ ownerId: 'one', turnCount: 1, recordCount: 1 }],
        turns: [],
      }),
      loadPage: () => new Promise((resolve) => (resolvePage = resolve)),
      subscribe: (_resource, _revision, onDelta) => {
        publish = onDelta
        return () => undefined
      },
    }
    const ownerOne = (): string => 'one'
    const hook = renderHook(() =>
      useTrajectoryExplorer({ resourceId: 'match', dataSource: source, initialOwner: ownerOne }),
    )
    await waitFor(() => expect(resolvePage).not.toBeNull())
    expect(publish).toBeNull()
    await act(async () => resolvePage?.(page('one', 2, [], [], null)))
    await waitFor(() => expect(publish).not.toBeNull())
    act(() => publish?.({ revision: 2, turns: [turn('one', 2)], records: [record('one', 2)] }))
    expect(hook.result.current.summary?.turns).toHaveLength(1)
  })
})

function turn(ownerId: string, ordinal: number): Turn {
  return {
    matchId: 'match',
    turnId: `turn-${ownerId}-${ordinal}`,
    ownerId,
    status: 'completed',
    startedAt: '2026-08-31T00:00:00.000Z',
    completedAt: '2026-08-31T00:00:01.000Z',
    durationMs: 1000,
    stopReason: null,
    error: null,
    usage: null,
    ordinal,
  }
}

function record(ownerId: string, ordinal: number): RecordValue {
  return {
    matchId: 'match',
    recordId: `record-${ownerId}-${ordinal}`,
    turnId: `turn-${ownerId}-${ordinal}`,
    ownerId,
    kind: 'message',
    title: `Message ${ordinal}`,
    status: null,
    text: `text ${ordinal}`,
    input: null,
    output: null,
    startedAt: '2026-08-31T00:00:00.000Z',
    truncatedFields: [],
    ordinal,
    durationMs: 10,
  }
}

function page(
  ownerId: string,
  revision: number,
  turns: Turn[],
  records: RecordValue[],
  nextBeforeTurn: number | null,
): Page {
  return { revision, ownerId, turns, records, nextBeforeTurn }
}

function failingSource(
  failure = 'summary',
): TrajectoryDataSource<Turn, RecordValue, Owner, Summary, Page> {
  return {
    loadSummary: async () => {
      throw failure
    },
    loadPage: async () => {
      throw failure
    },
  }
}
