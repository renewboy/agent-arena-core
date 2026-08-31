import { useCallback, useEffect, useRef, useState } from 'react'
import type { TrajectoryRecordBase, TrajectoryTurnBase } from '@agent-arena/trajectory'

export interface TrajectoryOwnerLike {
  readonly ownerId: string
  readonly turnCount: number
  readonly recordCount: number
}

export interface TrajectorySummaryLike<
  Turn extends TrajectoryTurnBase,
  Owner extends TrajectoryOwnerLike,
> {
  readonly revision: number
  readonly owners: readonly Owner[]
  readonly turns: readonly Turn[]
}

export interface TrajectoryPageLike<
  Turn extends TrajectoryTurnBase,
  Record extends TrajectoryRecordBase,
> {
  readonly revision: number
  readonly ownerId: string
  readonly turns: readonly Turn[]
  readonly records: readonly Record[]
  readonly nextBeforeTurn: number | null
}

export interface TrajectoryDeltaLike<
  Turn extends TrajectoryTurnBase,
  Record extends TrajectoryRecordBase,
> {
  readonly revision: number
  readonly turns: readonly Turn[]
  readonly records: readonly Record[]
}

export interface TrajectoryDataSource<
  Turn extends TrajectoryTurnBase,
  Record extends TrajectoryRecordBase,
  Owner extends TrajectoryOwnerLike,
  Summary extends TrajectorySummaryLike<Turn, Owner>,
  Page extends TrajectoryPageLike<Turn, Record>,
> {
  loadSummary(resourceId: string, signal: AbortSignal): Promise<Summary>
  loadPage(
    resourceId: string,
    ownerId: string,
    beforeTurn: number | null,
    signal: AbortSignal,
  ): Promise<Page>
  subscribe?(
    resourceId: string,
    afterRevision: number,
    onDelta: (delta: TrajectoryDeltaLike<Turn, Record>) => void,
    onError: (error: unknown) => void,
  ): () => void
}

export interface TrajectoryExplorerState<
  Turn extends TrajectoryTurnBase,
  Record extends TrajectoryRecordBase,
  Owner extends TrajectoryOwnerLike,
  Summary extends TrajectorySummaryLike<Turn, Owner>,
  Page extends TrajectoryPageLike<Turn, Record>,
> {
  readonly summary: Summary | null
  readonly page: Page | null
  readonly ownerId: string | null
  readonly loading: boolean
  readonly error: Error | null
  readonly query: string
  readonly selectedId: string | null
  readonly selectOwner: (ownerId: string) => void
  readonly select: (id: string | null) => void
  readonly setQuery: (query: string) => void
  readonly loadOlder: () => Promise<void>
  readonly focus: (ownerId: string, beforeTurn: number | null, selectedId: string) => void
  readonly reload: () => void
}

export function useTrajectoryExplorer<
  Turn extends TrajectoryTurnBase,
  Record extends TrajectoryRecordBase,
  Owner extends TrajectoryOwnerLike,
  Summary extends TrajectorySummaryLike<Turn, Owner>,
  Page extends TrajectoryPageLike<Turn, Record>,
>({
  resourceId,
  dataSource,
  initialOwner,
}: {
  readonly resourceId: string | null
  readonly dataSource: TrajectoryDataSource<Turn, Record, Owner, Summary, Page>
  readonly initialOwner: (summary: Summary) => string | null
}): TrajectoryExplorerState<Turn, Record, Owner, Summary, Page> {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [page, setPage] = useState<Page | null>(null)
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [pageBeforeTurn, setPageBeforeTurn] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reloadRevision, setReloadRevision] = useState(0)
  const revision = useRef(0)
  const pendingSelection = useRef<string | null>(null)
  const summaryLoaded = summary !== null

  useEffect(() => {
    if (!resourceId) {
      setSummary(null)
      setPage(null)
      setOwnerId(null)
      setError(new Error('Trajectory resource is unavailable'))
      return undefined
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setSummary(null)
    setPage(null)
    setSelectedId(null)
    const load = async (): Promise<void> => {
      try {
        const next = await dataSource.loadSummary(resourceId, controller.signal)
        if (controller.signal.aborted) return
        revision.current = next.revision
        setSummary(next)
        setOwnerId(initialOwner(next))
        setPageBeforeTurn(null)
      } catch (cause) {
        if (!controller.signal.aborted) setError(normalizeError(cause))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [dataSource, initialOwner, reloadRevision, resourceId])

  useEffect(() => {
    if (!resourceId || !summaryLoaded || !ownerId) return undefined
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    const load = async (): Promise<void> => {
      try {
        const next = await dataSource.loadPage(
          resourceId,
          ownerId,
          pageBeforeTurn,
          controller.signal,
        )
        if (controller.signal.aborted) return
        revision.current = Math.max(revision.current, next.revision)
        setPage(next)
        if (pendingSelection.current) {
          setSelectedId(pendingSelection.current)
          pendingSelection.current = null
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(normalizeError(cause))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [dataSource, ownerId, pageBeforeTurn, resourceId, summaryLoaded])

  useEffect(() => {
    if (!resourceId || !summaryLoaded || !dataSource.subscribe) return undefined
    return dataSource.subscribe(
      resourceId,
      revision.current,
      (delta) => {
        revision.current = Math.max(revision.current, delta.revision)
        setSummary((current) =>
          current
            ? ({
                ...current,
                revision: delta.revision,
                turns: mergeTrajectoryBy(current.turns, delta.turns, (turn) => turn.turnId),
              } as Summary)
            : current,
        )
        setPage((current) => {
          if (!current) return current
          const turns = delta.turns.filter((turn) => turn.ownerId === current.ownerId)
          const records = delta.records.filter((record) => record.ownerId === current.ownerId)
          return {
            ...current,
            revision: delta.revision,
            turns: mergeTrajectoryBy(current.turns, turns, (turn) => turn.turnId),
            records: mergeTrajectoryBy(current.records, records, (record) => record.recordId),
          } as Page
        })
      },
      (cause) => setError(normalizeError(cause)),
    )
  }, [dataSource, resourceId, summaryLoaded])

  const selectOwner = useCallback((nextOwnerId: string) => {
    pendingSelection.current = null
    setOwnerId(nextOwnerId)
    setPageBeforeTurn(null)
    setSelectedId(null)
  }, [])

  const loadOlder = useCallback(async (): Promise<void> => {
    if (!resourceId || !page?.nextBeforeTurn || !ownerId) return
    const controller = new AbortController()
    try {
      const older = await dataSource.loadPage(
        resourceId,
        ownerId,
        page.nextBeforeTurn,
        controller.signal,
      )
      revision.current = Math.max(revision.current, older.revision)
      setPage((current) =>
        current
          ? ({
              ...current,
              revision: Math.max(current.revision, older.revision),
              turns: mergeTrajectoryBy(older.turns, current.turns, (turn) => turn.turnId),
              records: mergeTrajectoryBy(
                older.records,
                current.records,
                (record) => record.recordId,
              ),
              nextBeforeTurn: older.nextBeforeTurn,
            } as Page)
          : current,
      )
    } catch (cause) {
      setError(normalizeError(cause))
    }
  }, [dataSource, ownerId, page, resourceId])

  const focus = useCallback((nextOwnerId: string, beforeTurn: number | null, id: string) => {
    pendingSelection.current = id
    setSelectedId(null)
    setOwnerId(nextOwnerId)
    setPageBeforeTurn(beforeTurn)
  }, [])
  const reload = useCallback(() => setReloadRevision((current) => current + 1), [])

  return {
    summary,
    page,
    ownerId,
    loading,
    error,
    query,
    selectedId,
    selectOwner,
    select: setSelectedId,
    setQuery,
    loadOlder,
    focus,
    reload,
  }
}

export function mergeTrajectoryBy<Value>(
  current: readonly Value[],
  incoming: readonly Value[],
  key: (value: Value) => string,
): Value[] {
  const values = new Map(current.map((value) => [key(value), value]))
  for (const value of incoming) values.set(key(value), value)
  return [...values.values()]
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
