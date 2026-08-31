import { describe, expect, it, vi } from 'vitest'
import {
  LiveProjectionController,
  type LiveChannel,
  type LiveChannelHandlers,
  type LiveClientCommand,
  type LiveProjectionTransport,
  type RuntimeScheduler,
} from '../src/index.js'

interface Projection {
  readonly observer: string
  readonly value: string
  readonly settled?: boolean
}

interface Control {
  readonly enabled: boolean
}

class FakeChannel implements LiveChannel<string, string> {
  readonly sent: LiveClientCommand<string, string>[] = []
  closed = false

  public send(command: LiveClientCommand<string, string>): boolean {
    if (this.closed) return false
    this.sent.push(command)
    return true
  }

  public close(): void {
    this.closed = true
  }
}

class FakeTransport implements LiveProjectionTransport<
  string,
  Projection,
  string,
  Control,
  string
> {
  readonly loads: Array<{
    readonly observer: string
    readonly signal: AbortSignal
    readonly resolve: (projection: Projection) => void
    readonly reject: (error: unknown) => void
  }> = []
  readonly handlers: LiveChannelHandlers<string, Projection, string, Control>[] = []
  readonly channels: FakeChannel[] = []
  throwOnOpen = false

  public loadSnapshot(observer: string, signal: AbortSignal): Promise<Projection> {
    return new Promise((resolve, reject) => {
      this.loads.push({ observer, signal, resolve, reject })
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
  }

  public openChannel(
    _observer: string,
    handlers: LiveChannelHandlers<string, Projection, string, Control>,
  ): LiveChannel<string, string> {
    if (this.throwOnOpen) throw new Error('open failed')
    const channel = new FakeChannel()
    this.handlers.push(handlers)
    this.channels.push(channel)
    return channel
  }
}

class FakeScheduler implements RuntimeScheduler<number> {
  readonly scheduled: Array<{ readonly handle: number; readonly delay: number; run(): void }> = []
  readonly cleared: number[] = []
  #next = 1

  public set(delay: number, callback: () => void): number {
    const handle = this.#next++
    this.scheduled.push({ handle, delay, run: callback })
    return handle
  }

  public clear(handle: number): void {
    this.cleared.push(handle)
  }
}

function createController(transport = new FakeTransport(), scheduler = new FakeScheduler()) {
  const controller = new LiveProjectionController({
    observer: 'host',
    initialControlState: { enabled: false },
    transport,
    scheduler,
    observerKey: (observer) => observer,
    applyTransient: (projection, value) => ({
      ...projection,
      value: `${projection.value}${value}`,
    }),
    isSettled: (projection) => projection.settled === true,
    isUnavailableError: (error) => error instanceof Error && error.message === 'missing',
    disconnectedControlState: () => ({ enabled: false }),
  })
  return { controller, transport, scheduler }
}

describe('LiveProjectionController', () => {
  it('keeps a newer channel snapshot when the concurrent initial load finishes late', async () => {
    const { controller, transport } = createController()
    const changed = vi.fn()
    controller.subscribe(changed)
    controller.start()
    transport.handlers[0]!.open()
    transport.handlers[0]!.event({
      type: 'snapshot',
      observer: 'host',
      projection: { observer: 'host', value: 'channel' },
    })
    transport.loads[0]!.resolve({ observer: 'host', value: 'stale-load' })
    await Promise.resolve()

    expect(controller.snapshot()).toMatchObject({
      projection: { value: 'channel' },
      connectionState: 'live',
      observerPending: false,
    })
    expect(changed).toHaveBeenCalled()
  })

  it('normalizes transient/control events and keeps old projections inert during observer changes', () => {
    const { controller, transport } = createController()
    controller.start()
    const handler = transport.handlers[0]!
    handler.open()
    handler.event({
      type: 'snapshot',
      observer: 'host',
      projection: { observer: 'host', value: 'A' },
    })
    handler.event({ type: 'transient', value: 'B' })
    handler.event({ type: 'control', state: { enabled: true } })
    expect(controller.snapshot()).toMatchObject({
      projection: { value: 'AB' },
      controlState: { enabled: true },
    })

    expect(controller.setObserver('participant-one')).toBe(true)
    expect(controller.snapshot().observerPending).toBe(true)
    expect(transport.channels[0]!.sent).toEqual([
      { type: 'observer.set', observer: 'participant-one' },
    ])
    expect(controller.sendControl('skip')).toBe(true)
    handler.event({
      type: 'snapshot',
      observer: 'participant-one',
      projection: { observer: 'participant-one', value: 'private' },
    })
    expect(controller.snapshot().observerPending).toBe(false)
  })

  it('catches up before bounded reconnect and resets disconnected control state', async () => {
    const { controller, transport, scheduler } = createController()
    controller.start()
    transport.handlers[0]!.open()
    transport.handlers[0]!.event({ type: 'control', state: { enabled: true } })
    transport.handlers[0]!.close()
    expect(controller.snapshot()).toMatchObject({
      connectionState: 'reconnecting',
      controlState: { enabled: false },
    })
    transport.loads.at(-1)!.resolve({ observer: 'host', value: 'caught-up' })
    await Promise.resolve()
    await Promise.resolve()
    expect(scheduler.scheduled[0]?.delay).toBe(250)
    scheduler.scheduled[0]!.run()
    transport.handlers.at(-1)!.open()
    expect(controller.snapshot().connectionState).toBe('live')

    transport.handlers.at(-1)!.close()
    transport.loads.at(-1)!.reject(new Error('network'))
    await Promise.resolve()
    await Promise.resolve()
    expect(scheduler.scheduled.at(-1)?.delay).toBe(250)
  })

  it('settles terminal projections and converges missing resources to unavailable', async () => {
    const settled = createController()
    settled.controller.start()
    settled.transport.handlers[0]!.event({
      type: 'snapshot',
      observer: 'host',
      projection: { observer: 'host', value: 'done', settled: true },
    })
    expect(settled.controller.snapshot().connectionState).toBe('settled')
    expect(settled.transport.channels[0]!.closed).toBe(true)

    const missing = createController()
    missing.controller.start()
    missing.transport.loads[0]!.reject(new Error('missing'))
    await Promise.resolve()
    expect(missing.controller.snapshot()).toMatchObject({
      projection: null,
      connectionState: 'unavailable',
      observerPending: false,
    })
    expect(missing.transport.channels[0]!.closed).toBe(true)
  })

  it('reports protocol failures, retries unavailable state, and disposes active resources', async () => {
    const { controller, transport, scheduler } = createController()
    controller.start()
    transport.handlers[0]!.error('bad payload')
    expect(controller.snapshot().error?.message).toBe('bad payload')

    transport.handlers[0]!.close()
    transport.loads.at(-1)!.resolve({ observer: 'host', value: 'recovered' })
    await Promise.resolve()
    await Promise.resolve()
    scheduler.scheduled[0]!.run()
    const retry = controller.retry()
    transport.loads.at(-1)!.resolve({ observer: 'host', value: 'retry' })
    await expect(retry).resolves.toBe('loaded')

    const disposingRetry = controller.retry()
    const activeLoad = transport.loads.at(-1)!
    controller.dispose()
    expect(activeLoad.signal.aborted).toBe(true)
    await expect(disposingRetry).resolves.toBe('stale')
    expect(controller.setObserver('ignored')).toBe(false)
    expect(controller.sendControl('ignored')).toBe(false)
  })

  it('backs off when opening the channel throws', () => {
    const transport = new FakeTransport()
    const scheduler = new FakeScheduler()
    transport.throwOnOpen = true
    const { controller } = createController(transport, scheduler)
    controller.start()
    expect(controller.snapshot().connectionState).toBe('reconnecting')
    expect(controller.snapshot().error?.message).toBe('open failed')
    expect(scheduler.scheduled[0]?.delay).toBe(250)
    scheduler.scheduled[0]!.run()
    expect(scheduler.scheduled[1]?.delay).toBe(500)
    controller.dispose()
    expect(scheduler.cleared).toContain(scheduler.scheduled[1]!.handle)
  })

  it('loads a clean initial snapshot and handles product and reducer errors', async () => {
    const { controller, transport } = createController()
    controller.start()
    controller.start()
    expect(transport.channels).toHaveLength(1)
    transport.loads[0]!.resolve({ observer: 'host', value: 'loaded' })
    await Promise.resolve()
    expect(controller.snapshot().projection?.value).toBe('loaded')

    transport.handlers[0]!.event({ type: 'error', error: new Error('product') })
    expect(controller.snapshot().error?.message).toBe('product')
    transport.channels[0]!.close()
    expect(controller.setObserver('participant')).toBe(false)

    const throwingTransport = new FakeTransport()
    const throwing = new LiveProjectionController({
      observer: 'host',
      initialControlState: { enabled: false },
      transport: throwingTransport,
      scheduler: new FakeScheduler(),
      observerKey: (observer) => observer,
      applyTransient: () => {
        throw new Error('bad transient')
      },
      isSettled: () => false,
      isUnavailableError: () => false,
      disconnectedControlState: (state) => state,
    })
    throwing.start()
    throwingTransport.handlers[0]!.event({
      type: 'snapshot',
      observer: 'host',
      projection: { observer: 'host', value: 'safe' },
    })
    throwingTransport.handlers[0]!.event({ type: 'transient', value: 'bad' })
    expect(throwing.snapshot().error?.message).toBe('bad transient')
    expect(throwingTransport.channels[0]!.closed).toBe(true)
  })

  it('ignores transient data before a snapshot and closes on fatal errors', () => {
    const { controller, transport } = createController()
    controller.start()
    transport.handlers[0]!.event({ type: 'transient', value: 'ignored' })
    expect(controller.snapshot().projection).toBeNull()
    transport.handlers[0]!.event({ type: 'error', error: new Error('fatal'), fatal: true })
    expect(transport.channels[0]!.closed).toBe(true)
  })
})
