import { describe, expect, it, vi } from 'vitest'
import { FollowLatestController, SequencedCueQueue } from '../src/index.js'
import { ObservableState } from '../src/observable.js'

describe('ObservableState', () => {
  it('does not notify for the identical snapshot and removes subscribers', () => {
    const value = { count: 1 }
    const store = new ObservableState(value)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.set(value)
    expect(listener).not.toHaveBeenCalled()
    store.set({ count: 2 })
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
    store.set({ count: 3 })
    expect(listener).toHaveBeenCalledOnce()
    store.clear()
  })
})

describe('FollowLatestController', () => {
  it('preserves user reading position until explicitly returned to latest', () => {
    const controller = new FollowLatestController()
    const changed = vi.fn()
    controller.subscribe(changed)
    expect(controller.contentChanged()).toBe(true)
    controller.detach()
    expect(controller.contentChanged()).toBe(false)
    expect(controller.snapshot()).toEqual({
      following: false,
      detachedByUser: true,
      hasNewActivity: true,
    })
    controller.observeDistance(50, 96)
    expect(controller.snapshot().following).toBe(false)
    controller.observeDistance(0, 96)
    expect(controller.snapshot()).toEqual({
      following: true,
      detachedByUser: false,
      hasNewActivity: false,
    })
    controller.detach()
    controller.returnToLatest()
    expect(controller.snapshot().following).toBe(true)
    expect(changed).toHaveBeenCalled()
    controller.dispose()
  })

  it('uses a threshold while scrolling normally', () => {
    const controller = new FollowLatestController()
    controller.observeDistance(120, 96)
    expect(controller.snapshot().following).toBe(false)
    controller.observeDistance(20, 96)
    expect(controller.snapshot().following).toBe(true)
  })
})

describe('SequencedCueQueue', () => {
  it('builds a projection baseline, sorts, deduplicates, and advances cues', () => {
    const queue = new SequencedCueQueue<{ readonly id: string; readonly sequence: number }, string>(
      { key: (cue) => cue.id, sequence: (cue) => cue.sequence },
    )
    queue.update({
      cues: [{ id: 'old', sequence: 2 }],
      lastSequence: 2,
      projectionKey: 'host',
      enabled: true,
    })
    expect(queue.snapshot().current).toBeNull()
    queue.update({
      cues: [
        { id: 'second', sequence: 4 },
        { id: 'first', sequence: 3 },
        { id: 'first', sequence: 3 },
      ],
      lastSequence: 4,
      projectionKey: 'host',
      enabled: true,
    })
    expect(queue.snapshot()).toEqual({ current: { id: 'first', sequence: 3 }, pendingCount: 1 })
    queue.completeCurrent()
    expect(queue.snapshot().current).toEqual({ id: 'second', sequence: 4 })
    queue.completeCurrent()
    queue.completeCurrent()
    expect(queue.snapshot().current).toBeNull()
  })

  it('resets projection state and advances the baseline while disabled', () => {
    const queue = new SequencedCueQueue<{ id: string; sequence: number }, string>({
      key: (cue) => cue.id,
      sequence: (cue) => cue.sequence,
    })
    queue.update({ cues: [], lastSequence: 1, projectionKey: 'host', enabled: true })
    queue.update({
      cues: [{ id: 'a', sequence: 2 }],
      lastSequence: 2,
      projectionKey: 'host',
      enabled: true,
    })
    queue.update({
      cues: [{ id: 'a', sequence: 2 }],
      lastSequence: 2,
      projectionKey: 'host',
      enabled: false,
    })
    expect(queue.snapshot().current).toBeNull()
    queue.update({
      cues: [{ id: 'a', sequence: 2 }],
      lastSequence: 2,
      projectionKey: 'host',
      enabled: true,
    })
    expect(queue.snapshot().current).toBeNull()
    queue.update({
      cues: [{ id: 'b', sequence: 3 }],
      lastSequence: 3,
      projectionKey: 'player',
      enabled: true,
    })
    expect(queue.snapshot().current).toBeNull()
    queue.dispose()
  })
})
