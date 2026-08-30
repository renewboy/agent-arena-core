import {
  GameEventDraftSchema,
  GameEventSchema,
  type GameEvent,
  type GameEventDraft,
  type MatchId,
} from '@agent-arena/contracts'
import { assertRule } from './errors.js'

export type EventReducer<State> = (state: State, event: GameEvent) => State

export interface EventJournalOptions<State> {
  readonly matchId: MatchId
  readonly initialState: State
  readonly reducer: EventReducer<State>
  readonly events?: readonly GameEvent[]
  readonly clock?: () => Date
}

export class EventJournal<State> {
  readonly #matchId: MatchId
  readonly #initialState: State
  readonly #reducer: EventReducer<State>
  readonly #clock: () => Date
  readonly #events: GameEvent[] = []
  #state: State

  public constructor(options: EventJournalOptions<State>) {
    this.#matchId = options.matchId
    this.#initialState = options.initialState
    this.#state = options.initialState
    this.#reducer = options.reducer
    this.#clock = options.clock ?? (() => new Date())
    for (const event of options.events ?? []) this.#restore(event)
  }

  public get state(): State {
    return this.#state
  }

  public get events(): readonly GameEvent[] {
    return this.#events
  }

  public get revision(): number {
    return this.#events.at(-1)?.sequence ?? 0
  }

  public append(input: GameEventDraft): GameEvent {
    const draft = GameEventDraftSchema.parse(input)
    const event = GameEventSchema.parse({
      ...draft,
      matchId: this.#matchId,
      sequence: this.revision + 1,
      occurredAt: this.#clock().toISOString(),
    })
    this.#events.push(event)
    this.#state = this.#reducer(this.#state, event)
    return event
  }

  public appendAll(inputs: readonly GameEventDraft[]): GameEvent[] {
    return inputs.map((input) => this.append(input))
  }

  public replay(): State {
    return this.#events.reduce(this.#reducer, this.#initialState)
  }

  #restore(input: GameEvent): void {
    const event = GameEventSchema.parse(input)
    assertRule(event.matchId === this.#matchId, `Event ${event.sequence} belongs to another Match`)
    assertRule(event.sequence === this.revision + 1, `Event sequence ${event.sequence} is not next`)
    this.#events.push(event)
    this.#state = this.#reducer(this.#state, event)
  }
}
