import { describe, expect, it, vi } from 'vitest'
import { LiveSubscriptionHub, PresentationBarrierCoordinator } from '../src/index.js'

interface Connection {
  observer: 'host' | 'spectator'
}

describe('LiveSubscriptionHub', () => {
  it('broadcasts projected messages and supports observer updates and cleanup', () => {
    const hub = new LiveSubscriptionHub<string, string>()
    const firstMessages: string[] = []
    const secondMessages: string[] = []
    const first = { observer: 'host', send: (message: string) => firstMessages.push(message) }
    const second = { observer: 'hidden', send: (message: string) => secondMessages.push(message) }
    const unsubscribe = hub.subscribe(first)
    hub.subscribe(second)
    hub.broadcast((subscriber) => (subscriber.observer === 'hidden' ? null : 'public'))
    expect(firstMessages).toEqual(['public'])
    expect(secondMessages).toEqual([])
    expect(hub.setObserver(second, 'host')).toBe(true)
    hub.broadcast((subscriber) => subscriber.observer)
    expect(secondMessages).toEqual(['host'])
    unsubscribe()
    expect(hub.size).toBe(1)
    hub.clear()
    expect(hub.setObserver(first, 'hidden')).toBe(false)
  })
})

describe('PresentationBarrierCoordinator', () => {
  it('grants one owner and resolves only the exact pending key', async () => {
    const changed = vi.fn()
    const controls = vi.fn()
    const coordinator = createBarrier(changed, controls)
    const first: Connection = { observer: 'host' }
    const second: Connection = { observer: 'host' }
    expect(coordinator.setEnabled(first, true)).toBe('accepted')
    expect(coordinator.setEnabled(second, true)).toBe('busy')
    const pending = coordinator.waitFor({ key: 7, private: true })
    expect(coordinator.stateFor(first)).toEqual({
      enabled: true,
      controlledByThisConnection: true,
      pendingKey: 7,
    })
    expect(coordinator.resolve(first, 8, 'completed')).toBe('invalid')
    expect(coordinator.resolve(first, 7, 'completed')).toBe('accepted')
    await expect(pending).resolves.toBe('completed')
    expect(coordinator.resolve(first, 7, 'completed')).toBe('accepted')
    expect(changed).toHaveBeenCalled()
    expect(controls).toHaveBeenCalledWith({
      type: 'presentation.resolved',
      key: 7,
      outcome: 'completed',
    })
  })

  it('skips hidden, disconnected, disabled, and closed pending items', async () => {
    const coordinator = createBarrier()
    const owner: Connection = { observer: 'spectator' }
    expect(await coordinator.waitFor({ key: 1, private: false })).toBe('not-required')
    coordinator.setEnabled(owner, true)
    expect(await coordinator.waitFor({ key: 2, private: true })).toBe('not-required')

    owner.observer = 'host'
    const hidden = coordinator.waitFor({ key: 3, private: true })
    owner.observer = 'spectator'
    coordinator.observerChanged(owner)
    await expect(hidden).resolves.toBe('skipped')

    owner.observer = 'host'
    const disconnected = coordinator.waitFor({ key: 4, private: true })
    coordinator.disconnect(owner)
    await expect(disconnected).resolves.toBe('skipped')

    coordinator.setEnabled(owner, true)
    const disabled = coordinator.waitFor({ key: 5, private: false })
    expect(coordinator.setEnabled(owner, false)).toBe('accepted')
    await expect(disabled).resolves.toBe('skipped')

    coordinator.setEnabled(owner, true)
    const closed = coordinator.waitFor({ key: 6, private: false })
    coordinator.close()
    await expect(closed).resolves.toBe('skipped')
  })

  it('rejects a second simultaneous barrier', () => {
    const coordinator = createBarrier()
    const owner: Connection = { observer: 'host' }
    coordinator.setEnabled(owner, true)
    void coordinator.waitFor({ key: 1, private: false })
    expect(() => coordinator.waitFor({ key: 2, private: false })).toThrow(/already pending/u)
  })
})

function createBarrier(changed = vi.fn(), controls = vi.fn()) {
  return new PresentationBarrierCoordinator<
    Connection,
    Connection['observer'],
    { readonly key: number; readonly private: boolean },
    number
  >({
    key: (item) => item.key,
    observer: (connection) => connection.observer,
    isVisible: (item, observer) => !item.private || observer === 'host',
    onStateChange: changed,
    onControl: controls,
  })
}
