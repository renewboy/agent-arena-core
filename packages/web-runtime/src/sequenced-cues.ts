import type { SequencedCueState } from './contracts.js'
import { ObservableState } from './observable.js'

export interface SequencedCueQueueOptions<Cue, Key> {
  readonly sequence: (cue: Cue) => number
  readonly key: (cue: Cue) => Key
}

export interface SequencedCueUpdate<Cue> {
  readonly cues: readonly Cue[]
  readonly lastSequence: number
  readonly projectionKey: string
  readonly enabled: boolean
}

export class SequencedCueQueue<Cue, Key> {
  readonly #options: SequencedCueQueueOptions<Cue, Key>
  readonly #store = new ObservableState<SequencedCueState<Cue>>({ current: null, pendingCount: 0 })
  readonly #seen = new Set<Key>()
  readonly #pending: Cue[] = []
  #projectionKey: string | null = null
  #baseline: number | null = null
  #current: Cue | null = null

  public constructor(options: SequencedCueQueueOptions<Cue, Key>) {
    this.#options = options
  }

  public snapshot = (): SequencedCueState<Cue> => this.#store.snapshot()

  public subscribe = (listener: () => void): (() => void) => this.#store.subscribe(listener)

  public update(input: SequencedCueUpdate<Cue>): void {
    if (this.#projectionKey !== input.projectionKey) {
      this.#projectionKey = input.projectionKey
      this.#baseline = input.lastSequence
      this.#pending.length = 0
      this.#seen.clear()
      this.#current = null
      this.#emit()
      return
    }
    if (this.#baseline === null) {
      this.#baseline = input.lastSequence
      return
    }
    if (!input.enabled) {
      this.#baseline = Math.max(this.#baseline, input.lastSequence)
      this.#pending.length = 0
      this.#seen.clear()
      this.#current = null
      this.#emit()
      return
    }
    const additions = input.cues
      .filter((cue) => this.#options.sequence(cue) > (this.#baseline ?? 0))
      .sort((left, right) => this.#options.sequence(left) - this.#options.sequence(right))
    this.#baseline = Math.max(this.#baseline, input.lastSequence)
    for (const cue of additions) {
      const key = this.#options.key(cue)
      if (this.#seen.has(key)) continue
      this.#seen.add(key)
      this.#pending.push(cue)
    }
    if (this.#current === null) this.#current = this.#pending.shift() ?? null
    this.#emit()
  }

  public completeCurrent(): void {
    if (this.#current === null) return
    this.#current = this.#pending.shift() ?? null
    this.#emit()
  }

  public dispose(): void {
    this.#pending.length = 0
    this.#current = null
    this.#store.clear()
  }

  #emit(): void {
    const current = this.#store.snapshot()
    if (current.current === this.#current && current.pendingCount === this.#pending.length) return
    this.#store.set({ current: this.#current, pendingCount: this.#pending.length })
  }
}
