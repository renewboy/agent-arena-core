export class ObservableState<State> {
  #state: State
  readonly #listeners = new Set<() => void>()

  public constructor(initial: State) {
    this.#state = initial
  }

  public snapshot = (): State => this.#state

  public subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  public set(next: State): void {
    if (Object.is(this.#state, next)) return
    this.#state = next
    for (const listener of this.#listeners) listener()
  }

  public clear(): void {
    this.#listeners.clear()
  }
}
