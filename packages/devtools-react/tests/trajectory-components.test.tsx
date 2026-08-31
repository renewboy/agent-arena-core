// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const virtual = vi.hoisted(() => ({ scrollToIndex: vi.fn(), measureElement: vi.fn() }))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({
    count,
    getItemKey,
    estimateSize,
    getScrollElement,
  }: {
    count: number
    getItemKey: (index: number) => unknown
    estimateSize: (index: number) => number
    getScrollElement: () => Element | null
  }) => {
    getScrollElement()
    Array.from({ length: count }, (_, index) => estimateSize(index))
    return {
      getTotalSize: () => count * 40,
      getVirtualItems: () =>
        Array.from({ length: count }, (_, index) => ({
          index,
          key: getItemKey(index),
          start: index * 40,
        })),
      scrollToIndex: virtual.scrollToIndex,
      measureElement: virtual.measureElement,
    }
  },
}))

import {
  TrajectoryInspector,
  TrajectoryLedger,
  TrajectoryMinimap,
  type TrajectoryPresentationAdapter,
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
  readonly group: string
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

const adapter: TrajectoryPresentationAdapter<Turn, RecordValue> = {
  group: (turnValue) => ({ id: turnValue.group, label: `Group ${turnValue.group}` }),
  recordLabel: (recordValue) => `Kind ${recordValue.kind}`,
  recordPreview: (recordValue) => recordValue.text,
  lane: () => 'model',
  formatTime: () => '12:00',
  formatDuration: (value) => `${value ?? 0}ms`,
}

afterEach(() => {
  cleanup()
  virtual.scrollToIndex.mockReset()
})

describe('trajectory components', () => {
  it('renders and selects minimap records', async () => {
    const select = vi.fn()
    const records = [record(1, 'one'), record(2, 'one')]
    render(
      <TrajectoryMinimap
        adapter={adapter}
        records={records}
        selectedId="record-one-1"
        onSelect={select}
      />,
    )
    expect(screen.getByRole('button', { name: /#1/u })).toHaveAttribute('data-lane', 'model')
    await userEvent.click(screen.getByRole('button', { name: /#2/u }))
    expect(select).toHaveBeenCalledWith('record-one-2')
  })

  it('searches, collapses, selects, pages, follows, and restores owner scroll', async () => {
    const user = userEvent.setup()
    const select = vi.fn()
    const query = vi.fn()
    const loadOlder = vi.fn()
    const page = {
      revision: 2,
      ownerId: 'one',
      turns: [turn(1, 'one', 'a'), turn(2, 'one', 'b')],
      records: [record(1, 'one'), record(2, 'one')],
      nextBeforeTurn: 1,
    }
    const view = render(
      <TrajectoryLedger
        adapter={adapter}
        followLatest
        labels={{
          search: 'Search',
          loadOlder: 'Older',
          collapseAll: 'Collapse',
          expandAll: 'Expand',
          groupCount: (count) => `${count} records`,
        }}
        loading={false}
        page={page}
        query=""
        selectedId={null}
        onLoadOlder={loadOlder}
        onQuery={query}
        onSelect={select}
      />,
    )
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'text')
    expect(query).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Older' }))
    expect(loadOlder).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: /text 1/u }))
    expect(select).toHaveBeenCalledWith('record-one-1')
    await user.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Expand' }))
    await user.click(screen.getByRole('button', { name: /Group a/u }))
    await user.click(screen.getByRole('button', { name: /Group a/u }))

    const scroll = screen.getByRole('textbox').closest('section')!.querySelector('[data-owner]')
    void scroll
    const scrollContainer = screen.getByRole('button', { name: /text 1/u }).parentElement!
      .parentElement!.parentElement!
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, writable: true, value: 100 },
    })
    fireEvent.pointerDown(scrollContainer)
    fireEvent.keyDown(scrollContainer, { key: 'ArrowUp' })
    fireEvent.keyDown(scrollContainer, { key: 'PageUp' })
    fireEvent.keyDown(scrollContainer, { key: 'Home' })
    fireEvent.wheel(scrollContainer, { deltaY: -1 })
    fireEvent.wheel(scrollContainer, { deltaY: 1 })
    fireEvent.scroll(scrollContainer)

    view.rerender(
      <TrajectoryLedger
        adapter={adapter}
        followLatest={false}
        labels={{
          search: 'Search',
          loadOlder: 'Older',
          collapseAll: 'Collapse',
          expandAll: 'Expand',
          groupCount: (count) => `${count} records`,
        }}
        loading
        page={{ ...page, ownerId: 'two', nextBeforeTurn: null }}
        query="missing"
        selectedId="record-two-99"
        onLoadOlder={loadOlder}
        onQuery={query}
        onSelect={select}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Older' })).toBeNull()
    expect(virtual.scrollToIndex).toHaveBeenCalled()

    view.rerender(
      <TrajectoryLedger
        adapter={adapter}
        followLatest
        labels={{
          search: 'Search',
          loadOlder: 'Older',
          collapseAll: 'Collapse',
          expandAll: 'Expand',
          groupCount: (count) => `${count} records`,
        }}
        loading={false}
        page={page}
        query="zzz"
        selectedId={null}
        onLoadOlder={loadOlder}
        onQuery={query}
        onSelect={select}
      />,
    )
    expect(screen.queryByText('text 1')).toBeNull()
  })

  it('renders empty, turn, and record inspector slots', () => {
    const view = render(
      <TrajectoryInspector
        className="inspector"
        empty="Empty"
        record={null}
        turn={null}
        renderRecord={(value: RecordValue) => value.title}
        renderTurn={(value: Turn) => value.turnId}
      />,
    )
    expect(screen.getByText('Empty')).toBeInTheDocument()
    view.rerender(
      <TrajectoryInspector
        empty="Empty"
        record={null}
        turn={turn(1, 'one', 'a')}
        renderRecord={(value: RecordValue) => value.title}
        renderTurn={(value: Turn) => value.turnId}
      />,
    )
    expect(screen.getByText('turn-one-1')).toBeInTheDocument()
    view.rerender(
      <TrajectoryInspector
        empty="Empty"
        record={record(1, 'one')}
        turn={null}
        renderRecord={(value: RecordValue) => value.title}
        renderTurn={(value: Turn) => value.turnId}
      />,
    )
    expect(screen.getByText('Message 1')).toBeInTheDocument()
  })
})

function turn(ordinal: number, ownerId: string, group: string): Turn {
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
    group,
  }
}

function record(ordinal: number, ownerId: string): RecordValue {
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
