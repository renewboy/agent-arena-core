export interface LiveSubscriber<Observer, Message> {
  observer: Observer
  send(message: Message): void
}

export class LiveSubscriptionHub<Observer, Message> {
  readonly #subscribers = new Set<LiveSubscriber<Observer, Message>>()

  public get size(): number {
    return this.#subscribers.size
  }

  public subscribe(subscriber: LiveSubscriber<Observer, Message>): () => void {
    this.#subscribers.add(subscriber)
    return () => this.#subscribers.delete(subscriber)
  }

  public setObserver(subscriber: LiveSubscriber<Observer, Message>, observer: Observer): boolean {
    if (!this.#subscribers.has(subscriber)) return false
    subscriber.observer = observer
    return true
  }

  public broadcast(
    project: (subscriber: LiveSubscriber<Observer, Message>) => Message | null,
  ): void {
    for (const subscriber of this.#subscribers) {
      const message = project(subscriber)
      if (message !== null) subscriber.send(message)
    }
  }

  public clear(): void {
    this.#subscribers.clear()
  }
}
