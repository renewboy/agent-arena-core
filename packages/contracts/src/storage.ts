import type { DecisionId, GameId, MatchId, ParticipantId } from './ids.js'
import type { GameAction, GameEvent } from './game.js'
import type { JsonValue } from './json.js'
import type { RulesetLock } from './ruleset.js'

export type MatchRuntimeStatus = 'created' | 'running' | 'paused' | 'ended'

export interface StoredMatch<
  Setup extends JsonValue = JsonValue,
  Outcome extends JsonValue = JsonValue,
> {
  readonly matchId: MatchId
  readonly gameId: GameId
  readonly ruleset: RulesetLock
  readonly setup: Setup
  readonly status: MatchRuntimeStatus
  readonly outcome: Outcome | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface MatchStore<
  Setup extends JsonValue = JsonValue,
  Outcome extends JsonValue = JsonValue,
> {
  create(record: StoredMatch<Setup, Outcome>): StoredMatch<Setup, Outcome>
  get(matchId: MatchId): StoredMatch<Setup, Outcome> | null
  setStatus(
    matchId: MatchId,
    status: MatchRuntimeStatus,
    outcome?: Outcome | null,
  ): StoredMatch<Setup, Outcome>
  appendEvents(matchId: MatchId, events: readonly GameEvent[]): void
  events(matchId: MatchId): readonly GameEvent[]
  delete(matchId: MatchId): void
}

export type SessionBindingState = 'creating' | 'active' | 'closed'
export type SessionBootstrapState = 'pending' | 'dispatched' | 'acknowledged'

export interface PendingAcceptedAction<Action extends GameAction = GameAction> {
  readonly decisionId: DecisionId
  readonly action: Action
  readonly acceptedAt: string
}

export interface SessionBinding<Action extends GameAction = GameAction> {
  readonly matchId: MatchId
  readonly participantId: ParticipantId
  readonly state: SessionBindingState
  readonly sessionId: string | null
  readonly sessionGeneration: number
  readonly bootstrapState: SessionBootstrapState
  readonly pendingAction: PendingAcceptedAction<Action> | null
}

export interface SessionBindingStore<Action extends GameAction = GameAction> {
  get(matchId: MatchId, participantId: ParticipantId): SessionBinding<Action> | null
  put(binding: SessionBinding<Action>): SessionBinding<Action>
  savePendingAction(
    matchId: MatchId,
    participantId: ParticipantId,
    decisionId: DecisionId,
    action: Action,
    acceptedAt?: string,
  ): SessionBinding<Action>
  clearPendingAction(matchId: MatchId, participantId: ParticipantId): SessionBinding<Action>
  deleteMatch(matchId: MatchId): void
}

export interface DeliveryStore<Snapshot extends JsonValue = JsonValue> {
  get(matchId: MatchId, participantId: ParticipantId): Snapshot | null
  put(matchId: MatchId, participantId: ParticipantId, snapshot: Snapshot): Snapshot
  deleteMatch(matchId: MatchId): void
}

export interface StoredTrajectoryEntry<Value extends JsonValue = JsonValue> {
  readonly matchId: MatchId
  readonly id: string
  readonly ownerId: ParticipantId | 'system'
  readonly ordinal: number
  readonly value: Value
}

export interface TrajectoryStore<
  Turn extends JsonValue = JsonValue,
  RecordValue extends JsonValue = JsonValue,
> {
  putTurn(entry: StoredTrajectoryEntry<Turn>): StoredTrajectoryEntry<Turn>
  putRecord(entry: StoredTrajectoryEntry<RecordValue>): StoredTrajectoryEntry<RecordValue>
  turns(matchId: MatchId): readonly StoredTrajectoryEntry<Turn>[]
  records(matchId: MatchId): readonly StoredTrajectoryEntry<RecordValue>[]
  deleteMatch(matchId: MatchId): void
}

export interface ValueCodec<Value> {
  parse(input: unknown): Value
}
