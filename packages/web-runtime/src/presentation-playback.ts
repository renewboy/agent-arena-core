import type {
  PlaybackNotice,
  PresentationOutcome,
  PresentationPlaybackOptions,
  PresentationPlaybackState,
  PresentationPlaybackUpdate,
} from './contracts.js'
import { ObservableState } from './observable.js'

interface StreamJob<Actor> {
  readonly id: number
  readonly actor: Actor
  observedText: string
  consumedLength: number
  nextUnit: number
  pendingUnits: number
  finalSequence: number | null
  outcome: PresentationOutcome
}

type PlaybackUnit<Item> =
  | {
      readonly key: string
      readonly source: 'committed'
      readonly text: string
      readonly item: Item
    }
  | {
      readonly key: string
      readonly source: 'stream'
      readonly text: string
      readonly streamId: number
    }

export class PresentationPlaybackController<Item, Actor> {
  readonly #options: PresentationPlaybackOptions<Item, Actor>
  readonly #store: ObservableState<PresentationPlaybackState<Actor>>
  readonly #seenSequences = new Set<number>()
  readonly #outcomes = new Map<number, PresentationOutcome>()
  readonly #resolvedBarriers = new Set<number>()
  readonly #streamJobs = new Map<number, StreamJob<Actor>>()
  #queue: PlaybackUnit<Item>[] = []
  #current: PlaybackUnit<Item> | null = null
  #activeStream: StreamJob<Actor> | null = null
  #streamingActive = false
  #controlled = false
  #projectionKey: string | null = null
  #pendingSequence: number | null = null
  #interruptedSequence: number | null = null
  #automaticSequence: number | null = null
  #automaticActor: Actor | null = null
  #manualSequence: number | null = null
  #notice: PlaybackNotice | null = null
  #operation = 0
  #nextStreamId = 1
  #disposed = false

  public constructor(options: PresentationPlaybackOptions<Item, Actor>) {
    this.#options = options
    this.#store = new ObservableState(this.#state())
  }

  public snapshot = (): PresentationPlaybackState<Actor> => this.#store.snapshot()

  public subscribe = (listener: () => void): (() => void) => this.#store.subscribe(listener)

  public update(input: PresentationPlaybackUpdate<Item, Actor>): void {
    if (this.#disposed) return
    this.#pendingSequence = input.pendingSequence
    const items = input.items.filter(this.#options.isPresentable)
    if (input.pendingSequence !== null) {
      const outcome = this.#outcomes.get(input.pendingSequence)
      if (outcome) this.#resolveBarrier(input.pendingSequence, outcome)
    }

    if (!input.controlled) {
      if (this.#controlled) {
        this.#cancelEngine()
        this.#clearAutomatic()
        this.#interruptedSequence = null
        this.#seenSequences.clear()
        this.#outcomes.clear()
        this.#resolvedBarriers.clear()
      }
      this.#controlled = false
      this.#emit()
      return
    }

    if (!this.#controlled) {
      this.#controlled = true
      this.#projectionKey = input.projectionKey
      this.#replaceSeen(items)
      this.#clearAutomatic()
    }

    if (input.observerPending) {
      if (this.#current) this.#interruptedSequence = this.#sequenceForUnit(this.#current)
      this.#cancelEngine()
      this.#clearAutomatic()
      this.#emit()
      return
    }

    if (this.#projectionKey !== input.projectionKey) {
      this.#projectionKey = input.projectionKey
      const replaySequence = input.pendingSequence ?? this.#interruptedSequence
      this.#interruptedSequence = null
      this.#replaceSeen(items)
      this.#outcomes.clear()
      this.#resolvedBarriers.clear()
      this.#cancelEngine()
      this.#clearAutomatic()
      const replay = items.find((item) => this.#options.sequence(item) === replaySequence)
      if (replay) this.#enqueueCommitted(replay)
    }

    this.#mergeItems(items)
    this.#mergeStream(input.activeStream)
    this.#ensurePending(items, input.pendingSequence)
    this.#startNext()
    this.#emit()
  }

  public playManual(item: Item): void {
    if (
      this.#disposed ||
      !this.#options.port.supported ||
      this.#streamingActive ||
      this.#queue.length > 0 ||
      this.#current ||
      this.#manualSequence !== null
    ) {
      return
    }
    this.#cancelEngine()
    const sequence = this.#options.sequence(item)
    this.#manualSequence = sequence
    this.#notice = null
    const operation = this.#operation
    const settle = (): void => {
      if (this.#operation !== operation) return
      this.#manualSequence = null
      this.#emit()
    }
    try {
      this.#options.port.speak(this.#options.text(item), {
        end: settle,
        error: settle,
      })
    } catch {
      settle()
      this.#notice = 'manual-failed'
    }
    this.#emit()
  }

  public stopManual(): void {
    if (this.#disposed) return
    this.#cancelEngine()
    this.#manualSequence = null
    this.#emit()
  }

  public skipAutomatic(): void {
    const current = this.#current
    if (this.#disposed || !current) return
    this.#cancelEngine()
    if (current.source === 'committed') {
      this.#finishUnit(current, 'skipped')
      return
    }
    const job = this.#streamJobs.get(current.streamId)
    if (!job) return
    this.#current = null
    job.pendingUnits = 0
    job.outcome = 'skipped'
    this.#queue = this.#queue.filter(
      (entry) => entry.source !== 'stream' || entry.streamId !== job.id,
    )
    this.#automaticSequence = null
    this.#automaticActor = null
    if (job.finalSequence !== null) {
      this.#streamJobs.delete(job.id)
      this.#finishSequence(job.finalSequence, 'skipped')
    }
    this.#startNext()
    this.#emit()
  }

  public cancelAll(): void {
    if (this.#disposed) return
    this.#cancelEngine()
    this.#clearAutomatic()
    this.#manualSequence = null
    this.#emit()
  }

  public dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#cancelEngine()
    this.#clearAutomatic()
    this.#store.clear()
  }

  #mergeItems(items: readonly Item[]): void {
    const additions = items.filter((item) => !this.#seenSequences.has(this.#options.sequence(item)))
    for (const item of additions) {
      const sequence = this.#options.sequence(item)
      this.#seenSequences.add(sequence)
      const actor = this.#options.actor(item)
      const job = [...this.#streamJobs.values()].find(
        (candidate) =>
          candidate.finalSequence === null &&
          actor !== null &&
          this.#options.sameActor(candidate.actor, actor),
      )
      if (!job) {
        this.#enqueueCommitted(item)
        continue
      }
      this.#enqueueStreamText(job, this.#options.text(item), true)
      job.finalSequence = sequence
      if (this.#activeStream?.id === job.id) {
        this.#activeStream = null
        this.#streamingActive = false
      }
      if (this.#current?.source === 'stream' && this.#current.streamId === job.id) {
        this.#automaticSequence = sequence
        this.#automaticActor = job.actor
      }
      if (job.pendingUnits === 0) {
        this.#streamJobs.delete(job.id)
        this.#finishSequence(sequence, job.outcome)
      }
    }
  }

  #mergeStream(stream: PresentationPlaybackUpdate<Item, Actor>['activeStream']): void {
    if (!stream || stream.final) return
    let job = this.#activeStream
    if (
      !job ||
      job.finalSequence !== null ||
      !this.#options.sameActor(job.actor, stream.actor) ||
      !stream.text.startsWith(job.observedText)
    ) {
      job = {
        id: this.#nextStreamId++,
        actor: stream.actor,
        observedText: '',
        consumedLength: 0,
        nextUnit: 0,
        pendingUnits: 0,
        finalSequence: null,
        outcome: 'completed',
      }
      this.#activeStream = job
      this.#streamJobs.set(job.id, job)
    }
    this.#streamingActive = true
    this.#enqueueStreamText(job, stream.text, false)
  }

  #ensurePending(items: readonly Item[], sequence: number | null): void {
    if (sequence === null || this.#outcomes.has(sequence) || this.#sequenceInFlight(sequence)) {
      return
    }
    const pending = items.find((item) => this.#options.sequence(item) === sequence)
    if (!pending) return
    this.#seenSequences.add(sequence)
    this.#enqueueCommitted(pending)
  }

  #enqueueCommitted(item: Item): void {
    const sequence = this.#options.sequence(item)
    this.#mergeQueue([
      {
        key: `committed:${sequence}`,
        source: 'committed',
        text: this.#options.text(item),
        item,
      },
    ])
  }

  #enqueueStreamText(job: StreamJob<Actor>, text: string, flushTail: boolean): void {
    if (job.outcome === 'skipped') {
      job.observedText = text
      job.consumedLength = text.length
      return
    }
    const unconsumed = text.slice(Math.min(job.consumedLength, text.length))
    const extracted = this.#options.segment(unconsumed)
    const segments = [...extracted.segments]
    let consumed = extracted.consumedLength
    if (flushTail) {
      const tail = unconsumed.slice(consumed).trim()
      if (tail) segments.push(tail)
      consumed = unconsumed.length
    }
    const units = segments.map<PlaybackUnit<Item>>((segment) => ({
      key: `stream:${job.id}:${job.nextUnit++}`,
      source: 'stream',
      text: segment,
      streamId: job.id,
    }))
    job.pendingUnits += units.length
    this.#mergeQueue(units)
    job.consumedLength = Math.min(text.length, job.consumedLength + consumed)
    job.observedText = text
  }

  #mergeQueue(additions: readonly PlaybackUnit<Item>[]): void {
    const merged = new Map(this.#queue.map((unit) => [unit.key, unit]))
    for (const unit of additions) merged.set(unit.key, unit)
    this.#queue = [...merged.values()]
  }

  #startNext(): void {
    if (this.#disposed || !this.#controlled || this.#current) return
    const unit = this.#queue[0]
    if (!unit) return
    this.#cancelEngine()
    this.#manualSequence = null
    this.#current = unit
    this.#notice = null
    this.#automaticSequence = this.#sequenceForUnit(unit)
    this.#automaticActor = this.#actorForUnit(unit)
    if (!this.#options.port.supported) {
      this.#notice = 'automatic-unsupported-skipped'
      this.#finishUnit(unit, 'skipped')
      return
    }
    const operation = this.#operation
    try {
      this.#options.port.speak(unit.text, {
        end: () => {
          if (this.#operation === operation) this.#finishUnit(unit, 'completed')
        },
        error: () => {
          if (this.#operation !== operation) return
          this.#notice = 'automatic-failed-skipped'
          this.#finishUnit(unit, 'skipped')
        },
      })
    } catch {
      if (this.#operation === operation) {
        this.#notice = 'automatic-failed-skipped'
        this.#finishUnit(unit, 'skipped')
      }
    }
  }

  #finishUnit(unit: PlaybackUnit<Item>, outcome: PresentationOutcome): void {
    if (this.#current?.key !== unit.key) return
    this.#current = null
    this.#automaticSequence = null
    this.#automaticActor = null
    this.#queue = this.#queue.filter((entry) => entry.key !== unit.key)
    if (unit.source === 'committed') {
      this.#finishSequence(this.#options.sequence(unit.item), outcome)
    } else {
      const job = this.#streamJobs.get(unit.streamId)
      if (job) {
        job.pendingUnits = Math.max(0, job.pendingUnits - 1)
        if (outcome === 'skipped') job.outcome = 'skipped'
        if (job.pendingUnits === 0 && job.finalSequence !== null) {
          this.#streamJobs.delete(job.id)
          this.#finishSequence(job.finalSequence, job.outcome)
        }
      }
    }
    this.#startNext()
    this.#emit()
  }

  #finishSequence(sequence: number, outcome: PresentationOutcome): void {
    this.#outcomes.set(sequence, outcome)
    if (this.#automaticSequence === sequence) this.#automaticSequence = null
    if (this.#pendingSequence === sequence) this.#resolveBarrier(sequence, outcome)
  }

  #resolveBarrier(sequence: number, outcome: PresentationOutcome): void {
    if (this.#resolvedBarriers.has(sequence)) return
    this.#resolvedBarriers.add(sequence)
    this.#options.resolve(sequence, outcome)
  }

  #sequenceForUnit(unit: PlaybackUnit<Item>): number | null {
    return unit.source === 'committed'
      ? this.#options.sequence(unit.item)
      : (this.#streamJobs.get(unit.streamId)?.finalSequence ?? null)
  }

  #actorForUnit(unit: PlaybackUnit<Item>): Actor | null {
    return unit.source === 'committed'
      ? this.#options.actor(unit.item)
      : (this.#streamJobs.get(unit.streamId)?.actor ?? null)
  }

  #sequenceInFlight(sequence: number): boolean {
    const matches = (unit: PlaybackUnit<Item>): boolean => this.#sequenceForUnit(unit) === sequence
    return (
      [...this.#streamJobs.values()].some((job) => job.finalSequence === sequence) ||
      (this.#current ? matches(this.#current) : false) ||
      this.#queue.some(matches)
    )
  }

  #replaceSeen(items: readonly Item[]): void {
    this.#seenSequences.clear()
    for (const item of items) this.#seenSequences.add(this.#options.sequence(item))
  }

  #clearAutomatic(): void {
    this.#current = null
    this.#activeStream = null
    this.#streamJobs.clear()
    this.#queue = []
    this.#automaticSequence = null
    this.#automaticActor = null
    this.#streamingActive = false
  }

  #cancelEngine(): void {
    this.#operation += 1
    try {
      this.#options.port.cancel()
    } catch {
      // Cancellation is best effort; operation tokens still invalidate stale callbacks.
    }
  }

  #state(): PresentationPlaybackState<Actor> {
    return {
      supported: this.#options.port.supported,
      automaticSequence: this.#automaticSequence,
      automaticActor: this.#automaticActor,
      automaticBusy:
        this.#streamingActive ||
        this.#automaticSequence !== null ||
        this.#queue.length > 0 ||
        this.#manualSequence !== null,
      manualSequence: this.#manualSequence,
      notice: this.#notice,
    }
  }

  #emit(): void {
    const current = this.#store.snapshot()
    const next = this.#state()
    if (
      current.supported === next.supported &&
      current.automaticSequence === next.automaticSequence &&
      current.automaticActor === next.automaticActor &&
      current.automaticBusy === next.automaticBusy &&
      current.manualSequence === next.manualSequence &&
      current.notice === next.notice
    ) {
      return
    }
    this.#store.set(next)
  }
}
