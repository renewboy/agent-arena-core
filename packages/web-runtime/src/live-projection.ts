import type {
  LiveChannel,
  LiveProjectionControllerOptions,
  LiveProjectionState,
  LiveServerEvent,
} from './contracts.js'
import { ObservableState } from './observable.js'

type LoadResult = 'loaded' | 'missing' | 'failed' | 'stale'

export class LiveProjectionController<
  Observer,
  Projection,
  Transient,
  ControlState,
  ControlCommand,
  TimerHandle = unknown,
> {
  readonly #options: LiveProjectionControllerOptions<
    Observer,
    Projection,
    Transient,
    ControlState,
    ControlCommand,
    TimerHandle
  >
  readonly #store: ObservableState<LiveProjectionState<Projection, ControlState>>
  #observer: Observer
  #loadedObserverKey: string | null = null
  #channel: LiveChannel<Observer, ControlCommand> | null = null
  #channelEpoch = 0
  #projectionMutation = 0
  #loadController: AbortController | null = null
  #reconnectTimer: TimerHandle | null = null
  #reconnectDelay: number
  #started = false
  #disposed = false

  public constructor(
    options: LiveProjectionControllerOptions<
      Observer,
      Projection,
      Transient,
      ControlState,
      ControlCommand,
      TimerHandle
    >,
  ) {
    this.#options = options
    this.#observer = options.observer
    this.#reconnectDelay = options.initialReconnectDelayMs ?? 250
    this.#store = new ObservableState({
      projection: null,
      controlState: options.initialControlState,
      connectionState: 'connecting',
      observerPending: false,
      error: null,
    })
  }

  public snapshot = (): LiveProjectionState<Projection, ControlState> => this.#store.snapshot()

  public subscribe = (listener: () => void): (() => void) => this.#store.subscribe(listener)

  public start(): void {
    if (this.#disposed || this.#started) return
    this.#started = true
    this.#update({ connectionState: 'connecting', error: null })
    void this.#loadCurrent()
    this.#connect()
  }

  public observer(): Observer {
    return this.#observer
  }

  public setObserver(observer: Observer): boolean {
    if (this.#disposed) return false
    const unchanged =
      this.#options.observerKey(observer) === this.#options.observerKey(this.#observer)
    this.#observer = observer
    this.#refreshObserverPending()
    if (unchanged) return true
    return this.#channel?.send({ type: 'observer.set', observer }) ?? false
  }

  public sendControl(command: ControlCommand): boolean {
    if (this.#disposed) return false
    return this.#channel?.send({ type: 'control', command }) ?? false
  }

  public async retry(): Promise<LoadResult> {
    if (this.#disposed) return 'failed'
    this.#clearReconnectTimer()
    this.#update({ connectionState: 'connecting', error: null })
    const result = await this.#loadCurrent()
    if (!this.#disposed && result !== 'missing' && this.snapshot().connectionState !== 'settled') {
      this.#connect()
    }
    return result
  }

  public dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#loadController?.abort()
    this.#loadController = null
    this.#clearReconnectTimer()
    this.#stopChannel()
    this.#store.clear()
  }

  private openChannel() {
    const epoch = ++this.#channelEpoch
    const openedObserverKey = this.#options.observerKey(this.#observer)
    return this.#options.transport.openChannel(this.#observer, {
      open: () => {
        if (!this.#isCurrentChannel(epoch)) return
        this.#reconnectDelay = this.#options.initialReconnectDelayMs ?? 250
        this.#update({ connectionState: 'live', error: null })
        if (openedObserverKey !== this.#options.observerKey(this.#observer)) {
          this.#channel?.send({ type: 'observer.set', observer: this.#observer })
        }
      },
      event: (event) => {
        if (!this.#isCurrentChannel(epoch)) return
        this.#receive(event)
      },
      error: (error) => {
        if (!this.#isCurrentChannel(epoch)) return
        this.#update({ error: normalizeError(error) })
        this.#channel?.close()
      },
      close: () => {
        if (!this.#isCurrentChannel(epoch)) return
        this.#channel = null
        void this.#recover(epoch)
      },
    })
  }

  #connect(): void {
    if (
      this.#disposed ||
      this.snapshot().connectionState === 'settled' ||
      this.snapshot().connectionState === 'unavailable'
    ) {
      return
    }
    this.#stopChannel()
    try {
      this.#channel = this.openChannel()
    } catch (error) {
      this.#update({ connectionState: 'reconnecting', error: normalizeError(error) })
      this.#scheduleReconnect()
    }
  }

  #receive(event: LiveServerEvent<Observer, Projection, Transient, ControlState>): void {
    switch (event.type) {
      case 'snapshot':
        this.#projectionMutation += 1
        this.#loadedObserverKey = this.#options.observerKey(event.observer)
        this.#update({ projection: event.projection, error: null })
        this.#refreshObserverPending()
        if (this.#options.isSettled(event.projection)) {
          this.#update({ connectionState: 'settled' })
          this.#channel?.close()
        }
        return
      case 'transient': {
        const projection = this.snapshot().projection
        if (projection === null) return
        try {
          const next = this.#options.applyTransient(projection, event.value)
          this.#projectionMutation += 1
          this.#update({ projection: next, error: null })
        } catch (error) {
          this.#update({ error: normalizeError(error) })
          this.#channel?.close()
        }
        return
      }
      case 'control':
        this.#update({ controlState: event.state })
        return
      case 'error':
        this.#update({ error: event.error })
        if (event.fatal) this.#channel?.close()
        return
      default: {
        const exhaustive: never = event
        return exhaustive
      }
    }
  }

  async #recover(epoch: number): Promise<void> {
    if (!this.#isCurrentEpoch(epoch)) return
    const current = this.snapshot()
    if (current.connectionState === 'settled' || current.connectionState === 'unavailable') return
    this.#update({
      connectionState: 'reconnecting',
      controlState: this.#options.disconnectedControlState(current.controlState),
    })
    const result = await this.#loadCurrent()
    if (!this.#isCurrentEpoch(epoch) || result === 'missing') return
    if (this.snapshot().connectionState === 'settled') return
    this.#scheduleReconnect()
  }

  async #loadCurrent(): Promise<LoadResult> {
    this.#loadController?.abort()
    const controller = new AbortController()
    this.#loadController = controller
    const observer = this.#observer
    const observerKey = this.#options.observerKey(observer)
    const mutation = this.#projectionMutation
    try {
      const projection = await this.#options.transport.loadSnapshot(observer, controller.signal)
      if (
        this.#disposed ||
        controller.signal.aborted ||
        this.#options.observerKey(this.#observer) !== observerKey ||
        this.#projectionMutation !== mutation
      ) {
        return 'stale'
      }
      this.#projectionMutation += 1
      this.#loadedObserverKey = observerKey
      this.#update({ projection, error: null })
      this.#refreshObserverPending()
      if (this.#options.isSettled(projection)) {
        this.#update({ connectionState: 'settled' })
        this.#stopChannel()
      }
      return 'loaded'
    } catch (error) {
      if (this.#disposed || controller.signal.aborted) return 'stale'
      if (this.#options.isUnavailableError(error)) {
        this.#projectionMutation += 1
        this.#loadedObserverKey = null
        this.#update({
          projection: null,
          connectionState: 'unavailable',
          observerPending: false,
          error: normalizeError(error),
        })
        this.#stopChannel()
        return 'missing'
      }
      this.#update({ error: normalizeError(error) })
      return 'failed'
    } finally {
      if (this.#loadController === controller) this.#loadController = null
    }
  }

  #scheduleReconnect(): void {
    if (this.#disposed || this.#reconnectTimer !== null) return
    const delay = this.#reconnectDelay
    this.#reconnectTimer = this.#options.scheduler.set(delay, () => {
      this.#reconnectTimer = null
      this.#connect()
    })
    this.#reconnectDelay = Math.min(delay * 2, this.#options.maximumReconnectDelayMs ?? 5_000)
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer === null) return
    this.#options.scheduler.clear(this.#reconnectTimer)
    this.#reconnectTimer = null
  }

  #stopChannel(): void {
    const channel = this.#channel
    this.#channel = null
    this.#channelEpoch += 1
    channel?.close()
  }

  #refreshObserverPending(): void {
    const projection = this.snapshot().projection
    const observerPending =
      projection !== null && this.#loadedObserverKey !== this.#options.observerKey(this.#observer)
    this.#update({ observerPending })
  }

  #isCurrentChannel(epoch: number): boolean {
    return !this.#disposed && epoch === this.#channelEpoch
  }

  #isCurrentEpoch(epoch: number): boolean {
    return !this.#disposed && epoch === this.#channelEpoch
  }

  #update(patch: Partial<LiveProjectionState<Projection, ControlState>>): void {
    const current = this.#store.snapshot()
    const next = { ...current, ...patch }
    if (
      current.projection === next.projection &&
      current.controlState === next.controlState &&
      current.connectionState === next.connectionState &&
      current.observerPending === next.observerPending &&
      current.error === next.error
    ) {
      return
    }
    this.#store.set(next)
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
