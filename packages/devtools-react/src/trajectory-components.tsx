import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useFollowLatest } from '@agent-arena/react'
import type { TrajectoryRecordBase, TrajectoryTurnBase } from '@agent-arena/trajectory'
import { FollowLatestController } from '@agent-arena/web-runtime'
import type { TrajectoryPageLike } from './trajectory-explorer.js'

export interface TrajectoryGroup {
  readonly id: string
  readonly label: ReactNode
}

export interface TrajectoryPresentationAdapter<
  Turn extends TrajectoryTurnBase & { readonly ordinal: number },
  Record extends TrajectoryRecordBase & {
    readonly ordinal: number
    readonly durationMs: number | null
  },
> {
  readonly group: (turn: Turn) => TrajectoryGroup
  readonly recordLabel: (record: Record) => ReactNode
  readonly recordPreview: (record: Record) => ReactNode
  readonly lane: (record: Record) => string
  readonly formatTime: (value: string) => ReactNode
  readonly formatDuration: (value: number | null) => ReactNode
}

export interface TrajectoryClassNames {
  readonly minimap?: string
  readonly minimapItem?: string
  readonly ledger?: string
  readonly toolbar?: string
  readonly toolbarActions?: string
  readonly input?: string
  readonly scroll?: string
  readonly virtual?: string
  readonly virtualRow?: string
  readonly group?: string
  readonly groupCount?: string
  readonly record?: string
  readonly kind?: string
  readonly inspector?: string
}

export function TrajectoryMinimap<
  Record extends TrajectoryRecordBase & {
    readonly ordinal: number
    readonly durationMs: number | null
  },
>({
  records,
  selectedId,
  adapter,
  classNames = {},
  onSelect,
}: {
  readonly records: readonly Record[]
  readonly selectedId: string | null
  readonly adapter: Pick<TrajectoryPresentationAdapter<never, Record>, 'lane'>
  readonly classNames?: TrajectoryClassNames
  readonly onSelect: (recordId: string) => void
}) {
  return (
    <nav className={classNames.minimap} aria-label="Trajectory minimap">
      {records.map((record) => (
        <button
          className={classNames.minimapItem}
          aria-label={`#${record.ordinal} ${record.title}`}
          aria-pressed={record.recordId === selectedId}
          data-lane={adapter.lane(record)}
          data-selected={record.recordId === selectedId}
          key={record.recordId}
          type="button"
          onClick={() => onSelect(record.recordId)}
        />
      ))}
    </nav>
  )
}

type LedgerRow<Turn, Record> =
  | {
      readonly kind: 'group'
      readonly key: string
      readonly group: TrajectoryGroup
      readonly recordCount: number
    }
  | { readonly kind: 'record'; readonly key: string; readonly record: Record; readonly turn: Turn }

export function TrajectoryLedger<
  Turn extends TrajectoryTurnBase & { readonly ordinal: number },
  Record extends TrajectoryRecordBase & {
    readonly ordinal: number
    readonly durationMs: number | null
  },
>({
  page,
  selectedId,
  query,
  loading,
  followLatest,
  adapter,
  classNames = {},
  labels,
  onQuery,
  onSelect,
  onLoadOlder,
}: {
  readonly page: TrajectoryPageLike<Turn, Record>
  readonly selectedId: string | null
  readonly query: string
  readonly loading: boolean
  readonly followLatest: boolean
  readonly adapter: TrajectoryPresentationAdapter<Turn, Record>
  readonly classNames?: TrajectoryClassNames
  readonly labels: {
    readonly search: string
    readonly loadOlder: ReactNode
    readonly collapseAll: ReactNode
    readonly expandAll: ReactNode
    readonly groupCount: (count: number) => ReactNode
  }
  readonly onQuery: (query: string) => void
  readonly onSelect: (recordId: string) => void
  readonly onLoadOlder: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualRef = useRef<HTMLDivElement>(null)
  const previousOwner = useRef<string | null>(null)
  const scrollByOwner = useRef(new Map<string, number>())
  const centeredSelection = useRef<string | null>(null)
  const expandedSelection = useRef<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set())
  const followController = useMemo(() => new FollowLatestController(), [])
  useFollowLatest(followController)
  const selectedRecord = page.records.find((record) => record.recordId === selectedId) ?? null
  const selectedTurn = selectedRecord
    ? (page.turns.find((turn) => turn.turnId === selectedRecord.turnId) ?? null)
    : null
  const selectedGroupId = selectedTurn ? adapter.group(selectedTurn).id : null
  const rows = useMemo(
    () => buildRows(page, query, collapsedGroups, adapter),
    [adapter, collapsedGroups, page, query],
  )
  const groupIds = useMemo(
    () => [...new Set(page.turns.map((turn) => adapter.group(turn).id))],
    [adapter, page.turns],
  )
  const allCollapsed =
    groupIds.length > 0 && groupIds.every((groupId) => collapsedGroups.has(groupId))
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'group' ? 42 : 38),
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 8,
    useFlushSync: false,
  })
  const totalSize = virtualizer.getTotalSize()

  useLayoutEffect(() => {
    if (virtualRef.current) virtualRef.current.style.height = `${totalSize}px`
  }, [totalSize])

  useLayoutEffect(() => {
    if (!selectedId) {
      expandedSelection.current = null
      return
    }
    if (expandedSelection.current === selectedId) return
    expandedSelection.current = selectedId
    if (!selectedGroupId) return
    setCollapsedGroups((current) => {
      if (!current.has(selectedGroupId)) return current
      const next = new Set(current)
      next.delete(selectedGroupId)
      return next
    })
  }, [selectedGroupId, selectedId])

  useLayoutEffect(() => {
    const ownerChanged = previousOwner.current !== page.ownerId
    previousOwner.current = page.ownerId
    if (rows.length > 0 && ownerChanged) {
      const saved = scrollByOwner.current.get(page.ownerId)
      if (saved !== undefined && scrollRef.current) {
        scrollRef.current.scrollTop = saved
        followController.detach()
      } else {
        if (followLatest) followController.returnToLatest()
        else followController.detach()
        virtualizer.scrollToIndex(followLatest ? rows.length - 1 : 0, {
          align: followLatest ? 'end' : 'start',
        })
      }
    } else if (rows.length > 0 && followLatest && followController.contentChanged()) {
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' })
    }
  }, [followController, followLatest, page.ownerId, rows.length, virtualizer])

  useLayoutEffect(() => {
    if (!selectedId) {
      centeredSelection.current = null
      return
    }
    if (centeredSelection.current === selectedId) return
    const index = rows.findIndex((row) => row.key === selectedId)
    if (index < 0) return
    centeredSelection.current = selectedId
    virtualizer.scrollToIndex(index, { align: 'center' })
  }, [rows, selectedId, virtualizer])

  return (
    <section className={classNames.ledger} aria-busy={loading} data-loading={loading}>
      <div className={classNames.toolbar}>
        <label>
          <span>{labels.search}</span>
          <input
            className={classNames.input}
            aria-label={labels.search}
            value={query}
            onChange={(event) => onQuery(event.target.value)}
          />
        </label>
        <div className={classNames.toolbarActions}>
          {page.nextBeforeTurn ? (
            <button type="button" onClick={onLoadOlder}>
              {labels.loadOlder}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setCollapsedGroups(allCollapsed ? new Set() : new Set(groupIds))}
          >
            {allCollapsed ? labels.expandAll : labels.collapseAll}
          </button>
        </div>
      </div>
      <div
        className={classNames.scroll}
        ref={scrollRef}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home') {
            followController.detach()
          }
        }}
        onPointerDown={() => followController.detach()}
        onScroll={(event) => {
          const target = event.currentTarget
          scrollByOwner.current.set(page.ownerId, target.scrollTop)
          followController.observeDistance(
            target.scrollHeight - target.scrollTop - target.clientHeight,
            80,
          )
        }}
        onWheel={(event) => {
          if (event.deltaY < 0) followController.detach()
        }}
      >
        <div className={classNames.virtual} ref={virtualRef}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]
            if (!row) return null
            return (
              <div
                className={classNames.virtualRow}
                data-index={virtualRow.index}
                key={row.key}
                ref={(element) => {
                  virtualizer.measureElement(element)
                  if (element) element.style.transform = `translateY(${virtualRow.start}px)`
                }}
              >
                {row.kind === 'group' ? (
                  <button
                    className={classNames.group}
                    aria-expanded={!collapsedGroups.has(row.group.id)}
                    type="button"
                    onClick={() =>
                      setCollapsedGroups((current) => toggleSet(current, row.group.id))
                    }
                  >
                    <strong>{row.group.label}</strong>
                    <small className={classNames.groupCount}>
                      {labels.groupCount(row.recordCount)}
                    </small>
                  </button>
                ) : (
                  <button
                    className={classNames.record}
                    data-kind={row.record.kind}
                    data-status={row.record.status}
                    data-selected={selectedId === row.record.recordId}
                    type="button"
                    onClick={() => onSelect(row.record.recordId)}
                  >
                    <span>#{row.record.ordinal}</span>
                    <span className={classNames.kind}>{adapter.recordLabel(row.record)}</span>
                    <small>{adapter.recordPreview(row.record)}</small>
                    <time dateTime={row.record.startedAt}>
                      {adapter.formatTime(row.record.startedAt)}
                    </time>
                    <em>{adapter.formatDuration(row.record.durationMs)}</em>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export function TrajectoryInspector<
  Turn extends TrajectoryTurnBase,
  Record extends TrajectoryRecordBase,
>({
  turn,
  record,
  empty,
  className,
  renderTurn,
  renderRecord,
}: {
  readonly turn: Turn | null
  readonly record: Record | null
  readonly empty: ReactNode
  readonly className?: string
  readonly renderTurn: (turn: Turn) => ReactNode
  readonly renderRecord: (record: Record) => ReactNode
}) {
  return (
    <div className={className}>
      {turn ? renderTurn(turn) : record ? renderRecord(record) : empty}
    </div>
  )
}

function buildRows<
  Turn extends TrajectoryTurnBase & { readonly ordinal: number },
  Record extends TrajectoryRecordBase & {
    readonly ordinal: number
    readonly durationMs: number | null
  },
>(
  page: TrajectoryPageLike<Turn, Record>,
  query: string,
  collapsed: ReadonlySet<string>,
  adapter: TrajectoryPresentationAdapter<Turn, Record>,
): Array<LedgerRow<Turn, Record>> {
  const needle = query.trim().toLocaleLowerCase()
  const groups = new Map<string, { group: TrajectoryGroup; turns: Turn[] }>()
  for (const turn of [...page.turns].sort((left, right) => left.ordinal - right.ordinal)) {
    const group = adapter.group(turn)
    const current = groups.get(group.id) ?? { group, turns: [] }
    current.turns.push(turn)
    groups.set(group.id, current)
  }
  return [...groups.values()].flatMap(({ group, turns }) => {
    const turnIds = new Set(turns.map((turn) => turn.turnId))
    const groupRecords = page.records
      .filter((record) => turnIds.has(record.turnId))
      .sort((left, right) => left.ordinal - right.ordinal)
    const records = groupRecords.filter((record) => {
      if (!needle) return true
      return `${record.title} ${record.text ?? ''} ${record.input ?? ''} ${record.output ?? ''}`
        .toLocaleLowerCase()
        .includes(needle)
    })
    if (needle && records.length === 0) return []
    const visible = !needle && collapsed.has(group.id) ? [] : records
    return [
      { kind: 'group' as const, key: `group:${group.id}`, group, recordCount: groupRecords.length },
      ...visible.map((record) => ({
        kind: 'record' as const,
        key: record.recordId,
        record,
        turn: turns.find((turn) => turn.turnId === record.turnId)!,
      })),
    ]
  })
}

function toggleSet(current: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(current)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}
