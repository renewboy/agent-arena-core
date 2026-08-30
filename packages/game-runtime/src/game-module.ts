import type {
  GameAction,
  GameEvent,
  GameId,
  JsonValue,
  MatchId,
  Observer,
  ParticipantId,
} from '@agent-arena/contracts'
import type { RulesetLock } from '@agent-arena/contracts'
import type { z } from 'zod'
import type { DecisionBoundary } from './decision.js'

export interface GameObservation<Facts> {
  readonly revision: number
  readonly observer: Observer
  readonly facts: Facts
  readonly visibleEventSequences: readonly number[]
}

export interface GameMachine<State, Outcome extends JsonValue> {
  readonly matchId: MatchId
  readonly state: State
  readonly events: readonly GameEvent[]
  readonly outcome: Outcome | null
  currentDecision(): DecisionBoundary | null
  validate(action: GameAction): GameAction
  submit(actions: readonly GameAction[]): readonly GameEvent[]
}

export interface GameModule<Setup, State, Facts, Outcome extends JsonValue> {
  readonly id: GameId
  readonly ruleset: RulesetLock
  readonly setupSchema: z.ZodType<Setup>
  readonly outcomeSchema: z.ZodType<Outcome>
  create(options: {
    readonly matchId: MatchId
    readonly setup: Setup
    readonly seed: number
    readonly clock?: () => Date
  }): GameMachine<State, Outcome>
  restore(options: {
    readonly matchId: MatchId
    readonly setup: Setup
    readonly events: readonly GameEvent[]
    readonly clock?: () => Date
  }): GameMachine<State, Outcome>
  observe(machine: GameMachine<State, Outcome>, observer: Observer): GameObservation<Facts>
  groups(machine: GameMachine<State, Outcome>): ReadonlyMap<string, ReadonlySet<ParticipantId>>
}
