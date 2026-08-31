import type {
  PresentationBarrierState,
  PresentationControlEvent,
  PresentationOutcome,
  PresentationWaitOutcome,
} from './contracts.js'

interface PendingPresentation<Item> {
  readonly item: Item
  readonly resolve: (outcome: PresentationOutcome) => void
}

export interface PresentationBarrierOptions<Connection, Observer, Item, Key> {
  readonly key: (item: Item) => Key
  readonly observer: (connection: Connection) => Observer
  readonly isVisible: (item: Item, observer: Observer) => boolean
  readonly onStateChange: () => void
  readonly onControl?: (event: PresentationControlEvent<Key>) => void
}

export class PresentationBarrierCoordinator<Connection, Observer, Item, Key> {
  readonly #options: PresentationBarrierOptions<Connection, Observer, Item, Key>
  readonly #resolved = new Set<Key>()
  #owner: Connection | null = null
  #pending: PendingPresentation<Item> | null = null

  public constructor(options: PresentationBarrierOptions<Connection, Observer, Item, Key>) {
    this.#options = options
  }

  public stateFor(connection: Connection): PresentationBarrierState<Key> {
    return {
      enabled: this.#owner !== null,
      controlledByThisConnection: this.#owner === connection,
      pendingKey:
        this.#pending &&
        this.#options.isVisible(this.#pending.item, this.#options.observer(connection))
          ? this.#options.key(this.#pending.item)
          : null,
    }
  }

  public setEnabled(connection: Connection, enabled: boolean): 'accepted' | 'busy' {
    if (enabled) {
      if (this.#owner !== null && this.#owner !== connection) return 'busy'
      this.#owner = connection
      this.#options.onControl?.({ type: 'presentation.enabled', enabled: true })
      this.#options.onStateChange()
      return 'accepted'
    }
    if (this.#owner !== null && this.#owner !== connection) return 'busy'
    this.#owner = null
    this.#settle('skipped')
    this.#options.onControl?.({ type: 'presentation.enabled', enabled: false })
    this.#options.onStateChange()
    return 'accepted'
  }

  public observerChanged(connection: Connection): void {
    if (
      this.#owner === connection &&
      this.#pending &&
      !this.#options.isVisible(this.#pending.item, this.#options.observer(connection))
    ) {
      this.#settle('skipped')
    }
    this.#options.onStateChange()
  }

  public waitFor(item: Item): Promise<PresentationWaitOutcome> {
    if (
      this.#owner === null ||
      !this.#options.isVisible(item, this.#options.observer(this.#owner))
    ) {
      return Promise.resolve('not-required')
    }
    if (this.#pending) throw new Error('A presentation barrier is already pending')
    return new Promise<PresentationOutcome>((resolve) => {
      this.#pending = { item, resolve }
      this.#options.onStateChange()
    })
  }

  public resolve(
    connection: Connection,
    key: Key,
    outcome: PresentationOutcome,
  ): 'accepted' | 'invalid' {
    if (this.#resolved.has(key)) return 'accepted'
    if (
      this.#owner !== connection ||
      !this.#pending ||
      !Object.is(this.#options.key(this.#pending.item), key)
    ) {
      return 'invalid'
    }
    this.#options.onControl?.({ type: 'presentation.resolved', key, outcome })
    this.#settle(outcome)
    return 'accepted'
  }

  public disconnect(connection: Connection): void {
    if (this.#owner !== connection) return
    this.#options.onControl?.({
      type: 'presentation.disconnected',
      key: this.#pending ? this.#options.key(this.#pending.item) : null,
    })
    this.#owner = null
    this.#settle('skipped')
    this.#options.onStateChange()
  }

  public close(): void {
    this.#owner = null
    this.#settle('skipped')
  }

  #settle(outcome: PresentationOutcome): void {
    const pending = this.#pending
    if (!pending) return
    this.#pending = null
    this.#resolved.add(this.#options.key(pending.item))
    pending.resolve(outcome)
    this.#options.onStateChange()
  }
}
