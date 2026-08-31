import { describe, expect, it, vi } from 'vitest'
import {
  PresentationPlaybackController,
  type PlaybackCallbacks,
  type PlaybackPort,
  type PresentationPlaybackUpdate,
} from '../src/index.js'

interface Item {
  readonly sequence: number
  readonly actor: string
  readonly text: string
  readonly presentable?: boolean
}

class FakePlaybackPort implements PlaybackPort {
  public supported = true
  readonly spoken: Array<{ readonly text: string; readonly callbacks: PlaybackCallbacks }> = []
  readonly cancel = vi.fn()
  throwNext = false

  public speak(text: string, callbacks: PlaybackCallbacks): void {
    if (this.throwNext) {
      this.throwNext = false
      throw new Error('speak failed')
    }
    this.spoken.push({ text, callbacks })
  }
}

function createPlayback(port = new FakePlaybackPort()) {
  const resolve = vi.fn(() => true)
  const controller = new PresentationPlaybackController<Item, string>({
    port,
    isPresentable: (item) => item.presentable !== false,
    sequence: (item) => item.sequence,
    actor: (item) => item.actor,
    text: (item) => item.text,
    sameActor: (left, right) => left === right,
    segment: (text) => {
      const index = text.search(/[.!?]/u)
      return index < 0
        ? { segments: [], consumedLength: 0 }
        : { segments: [text.slice(0, index + 1)], consumedLength: index + 1 }
    },
    resolve,
  })
  return { controller, port, resolve }
}

function update(
  controller: PresentationPlaybackController<Item, string>,
  values: Partial<PresentationPlaybackUpdate<Item, string>> = {},
): void {
  controller.update({
    items: [],
    activeStream: null,
    controlled: true,
    pendingSequence: null,
    projectionKey: 'host',
    observerPending: false,
    ...values,
  })
}

describe('PresentationPlaybackController', () => {
  it('plays an exact pending committed item and resolves it once', () => {
    const { controller, port, resolve } = createPlayback()
    update(controller, {
      items: [{ sequence: 7, actor: 'one', text: 'Ready.' }],
      pendingSequence: 7,
    })
    expect(port.spoken[0]?.text).toBe('Ready.')
    expect(controller.snapshot()).toMatchObject({
      automaticSequence: 7,
      automaticActor: 'one',
      automaticBusy: true,
    })
    port.spoken[0]!.callbacks.end()
    expect(resolve).toHaveBeenCalledWith(7, 'completed')
    update(controller, {
      items: [{ sequence: 7, actor: 'one', text: 'Ready.' }],
      pendingSequence: 7,
    })
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('streams complete units, flushes the committed tail, and binds one final sequence', () => {
    const { controller, port, resolve } = createPlayback()
    update(controller, {
      activeStream: { actor: 'one', text: 'First. tail', final: false },
    })
    expect(port.spoken[0]?.text).toBe('First.')
    port.spoken[0]!.callbacks.end()
    expect(resolve).not.toHaveBeenCalled()

    update(controller, {
      items: [{ sequence: 9, actor: 'one', text: 'First. tail' }],
      pendingSequence: 9,
    })
    expect(port.spoken[1]?.text).toBe('tail')
    port.spoken[1]!.callbacks.end()
    expect(resolve).toHaveBeenCalledWith(9, 'completed')
  })

  it('skips unsupported and failed automatic playback without blocking the barrier', () => {
    const unsupportedPort = new FakePlaybackPort()
    unsupportedPort.supported = false
    const unsupported = createPlayback(unsupportedPort)
    update(unsupported.controller, {
      items: [{ sequence: 2, actor: 'one', text: 'No audio.' }],
      pendingSequence: 2,
    })
    expect(unsupported.resolve).toHaveBeenCalledWith(2, 'skipped')
    expect(unsupported.controller.snapshot().notice).toBe('automatic-unsupported-skipped')

    const failed = createPlayback()
    failed.port.throwNext = true
    update(failed.controller, {
      items: [{ sequence: 3, actor: 'one', text: 'Failure.' }],
      pendingSequence: 3,
    })
    expect(failed.resolve).toHaveBeenCalledWith(3, 'skipped')
    expect(failed.controller.snapshot().notice).toBe('automatic-failed-skipped')
  })

  it('supports manual playback only while automatic presentation is idle', () => {
    const { controller, port } = createPlayback()
    update(controller)
    const item = { sequence: 4, actor: 'one', text: 'Manual.' }
    controller.playManual(item)
    expect(controller.snapshot().manualSequence).toBe(4)
    controller.playManual({ ...item, sequence: 5 })
    expect(port.spoken).toHaveLength(1)
    port.spoken[0]!.callbacks.error()
    expect(controller.snapshot().manualSequence).toBeNull()

    port.throwNext = true
    controller.playManual({ ...item, sequence: 6 })
    expect(controller.snapshot().notice).toBe('manual-failed')
    controller.stopManual()
  })

  it('interrupts observer changes, replays only a visible pending item, and allows explicit skip', () => {
    const { controller, port, resolve } = createPlayback()
    update(controller, {
      items: [{ sequence: 11, actor: 'one', text: 'Private.' }],
      pendingSequence: 11,
    })
    update(controller, {
      items: [{ sequence: 11, actor: 'one', text: 'Private.' }],
      pendingSequence: 11,
      observerPending: true,
    })
    expect(controller.snapshot().automaticSequence).toBeNull()
    update(controller, {
      items: [{ sequence: 11, actor: 'one', text: 'Private.' }],
      pendingSequence: 11,
      projectionKey: 'participant-one',
    })
    expect(port.spoken.at(-1)?.text).toBe('Private.')
    controller.skipAutomatic()
    expect(resolve).toHaveBeenCalledWith(11, 'skipped')
  })

  it('clears automatic state when control is lost or disposed', () => {
    const { controller, port } = createPlayback()
    update(controller, {
      items: [{ sequence: 12, actor: 'one', text: 'Active.' }],
      pendingSequence: 12,
    })
    update(controller, { controlled: false })
    expect(controller.snapshot().automaticBusy).toBe(false)
    controller.cancelAll()
    controller.dispose()
    expect(port.cancel).toHaveBeenCalled()
  })

  it('plays newly committed items, ignores non-presentable items, and reports callback failures', () => {
    const { controller, port, resolve } = createPlayback()
    update(controller, {
      items: [{ sequence: 1, actor: 'one', text: 'Baseline.' }],
    })
    update(controller, {
      items: [
        { sequence: 1, actor: 'one', text: 'Baseline.' },
        { sequence: 2, actor: 'one', text: 'Hidden.', presentable: false },
        { sequence: 3, actor: 'two', text: 'New.' },
      ],
      pendingSequence: 3,
    })
    expect(port.spoken.at(-1)?.text).toBe('New.')
    port.spoken.at(-1)!.callbacks.error(new Error('failed'))
    expect(resolve).toHaveBeenCalledWith(3, 'skipped')
    expect(controller.snapshot().notice).toBe('automatic-failed-skipped')
  })

  it('supports stream replacement and explicit stream skip before commit', () => {
    const { controller, port, resolve } = createPlayback()
    update(controller, {
      activeStream: { actor: 'one', text: 'One.', final: false },
    })
    update(controller, {
      activeStream: { actor: 'two', text: 'Two.', final: false },
    })
    expect(port.spoken[0]?.text).toBe('One.')
    controller.skipAutomatic()
    update(controller, {
      items: [{ sequence: 8, actor: 'one', text: 'One.' }],
      activeStream: { actor: 'two', text: 'Two.', final: false },
      pendingSequence: 8,
    })
    expect(resolve).toHaveBeenCalledWith(8, 'skipped')
  })

  it('holds incomplete stream text until commit and handles an absent replay item', () => {
    const { controller, port } = createPlayback()
    update(controller, {
      activeStream: { actor: 'one', text: 'unfinished', final: false },
    })
    expect(port.spoken).toHaveLength(0)
    update(controller, {
      items: [{ sequence: 5, actor: 'one', text: 'unfinished' }],
      pendingSequence: 5,
    })
    expect(port.spoken[0]?.text).toBe('unfinished')
    update(controller, {
      items: [],
      pendingSequence: 99,
      observerPending: true,
    })
    update(controller, {
      items: [],
      pendingSequence: 99,
      projectionKey: 'hidden',
    })
    expect(controller.snapshot().automaticSequence).toBeNull()
  })

  it('guards unsupported manual playback and best-effort cancellation', () => {
    const port = new FakePlaybackPort()
    port.supported = false
    port.cancel.mockImplementation(() => {
      throw new Error('cancel failed')
    })
    const { controller } = createPlayback(port)
    update(controller)
    controller.playManual({ sequence: 1, actor: 'one', text: 'Manual.' })
    expect(port.spoken).toHaveLength(0)
    expect(() => controller.stopManual()).not.toThrow()
    expect(() => controller.cancelAll()).not.toThrow()
  })
})
