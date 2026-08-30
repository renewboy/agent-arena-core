import {
  GameEventSchema,
  type DeliveryStore,
  type GameAction,
  type GameEvent,
  type JsonValue,
  type MatchId,
  type MatchRuntimeStatus,
  type MatchStore,
  type ParticipantId,
  type SessionBinding,
  type SessionBindingStore,
  type StoredMatch,
  type StoredTrajectoryEntry,
  type TrajectoryStore,
} from '@agent-arena/contracts'

export class MemoryMatchStore<
  Setup extends JsonValue,
  Outcome extends JsonValue,
> implements MatchStore<Setup, Outcome> {
  readonly #matches = new Map<MatchId, StoredMatch<Setup, Outcome>>()
  readonly #events = new Map<MatchId, GameEvent[]>()

  public create(record: StoredMatch<Setup, Outcome>): StoredMatch<Setup, Outcome> {
    if (this.#matches.has(record.matchId)) throw new Error(`Match ${record.matchId} already exists`)
    this.#matches.set(record.matchId, clone(record))
    this.#events.set(record.matchId, [])
    return this.get(record.matchId)!
  }

  public get(matchId: MatchId): StoredMatch<Setup, Outcome> | null {
    const record = this.#matches.get(matchId)
    return record ? clone(record) : null
  }

  public setStatus(
    matchId: MatchId,
    status: MatchRuntimeStatus,
    outcome?: Outcome | null,
  ): StoredMatch<Setup, Outcome> {
    const record = this.#matches.get(matchId)
    if (!record) throw new Error(`Unknown Match ${matchId}`)
    this.#matches.set(matchId, {
      ...record,
      status,
      outcome: outcome === undefined ? record.outcome : outcome,
      updatedAt: new Date().toISOString(),
    })
    return this.get(matchId)!
  }

  public appendEvents(matchId: MatchId, inputs: readonly GameEvent[]): void {
    const events = this.#events.get(matchId)
    if (!events) throw new Error(`Unknown Match ${matchId}`)
    for (const input of inputs) {
      const event = GameEventSchema.parse(input)
      if (event.matchId !== matchId || event.sequence !== events.length + 1) {
        throw new Error(`Event ${event.sequence} is not next for Match ${matchId}`)
      }
      events.push(event)
    }
  }

  public events(matchId: MatchId): readonly GameEvent[] {
    return [...(this.#events.get(matchId) ?? [])]
  }

  public delete(matchId: MatchId): void {
    this.#matches.delete(matchId)
    this.#events.delete(matchId)
  }
}

export class MemorySessionBindingStore<
  Action extends GameAction = GameAction,
> implements SessionBindingStore<Action> {
  readonly #bindings = new Map<string, SessionBinding<Action>>()

  public get(matchId: MatchId, participantId: ParticipantId): SessionBinding<Action> | null {
    const binding = this.#bindings.get(key(matchId, participantId))
    return binding ? clone(binding) : null
  }

  public put(binding: SessionBinding<Action>): SessionBinding<Action> {
    this.#bindings.set(key(binding.matchId, binding.participantId), clone(binding))
    return this.get(binding.matchId, binding.participantId)!
  }

  public savePendingAction(
    matchId: MatchId,
    participantId: ParticipantId,
    decisionId: Parameters<SessionBindingStore<Action>['savePendingAction']>[2],
    action: Action,
    acceptedAt = new Date().toISOString(),
  ): SessionBinding<Action> {
    const binding = this.get(matchId, participantId)
    if (!binding) throw new Error(`Missing Session binding ${matchId}/${participantId}`)
    return this.put({
      ...binding,
      pendingAction: { decisionId, action: clone(action), acceptedAt },
    })
  }

  public clearPendingAction(
    matchId: MatchId,
    participantId: ParticipantId,
  ): SessionBinding<Action> {
    const binding = this.get(matchId, participantId)
    if (!binding) throw new Error(`Missing Session binding ${matchId}/${participantId}`)
    return this.put({ ...binding, pendingAction: null })
  }

  public deleteMatch(matchId: MatchId): void {
    for (const [bindingKey, binding] of this.#bindings) {
      if (binding.matchId === matchId) this.#bindings.delete(bindingKey)
    }
  }
}

export class MemoryDeliveryStore<Snapshot extends JsonValue> implements DeliveryStore<Snapshot> {
  readonly #values = new Map<string, Snapshot>()

  public get(matchId: MatchId, participantId: ParticipantId): Snapshot | null {
    const value = this.#values.get(key(matchId, participantId))
    return value === undefined ? null : clone(value)
  }

  public put(matchId: MatchId, participantId: ParticipantId, snapshot: Snapshot): Snapshot {
    this.#values.set(key(matchId, participantId), clone(snapshot))
    return this.get(matchId, participantId)!
  }

  public deleteMatch(matchId: MatchId): void {
    const prefix = `${matchId}:`
    for (const valueKey of this.#values.keys()) {
      if (valueKey.startsWith(prefix)) this.#values.delete(valueKey)
    }
  }
}

export class MemoryTrajectoryStore<
  Turn extends JsonValue,
  RecordValue extends JsonValue,
> implements TrajectoryStore<Turn, RecordValue> {
  readonly #turns = new Map<MatchId, StoredTrajectoryEntry<Turn>[]>()
  readonly #records = new Map<MatchId, StoredTrajectoryEntry<RecordValue>[]>()

  public putTurn(entry: StoredTrajectoryEntry<Turn>): StoredTrajectoryEntry<Turn> {
    return this.put(this.#turns, entry)
  }

  public putRecord(entry: StoredTrajectoryEntry<RecordValue>): StoredTrajectoryEntry<RecordValue> {
    return this.put(this.#records, entry)
  }

  public turns(matchId: MatchId): readonly StoredTrajectoryEntry<Turn>[] {
    return clone(this.#turns.get(matchId) ?? [])
  }

  public records(matchId: MatchId): readonly StoredTrajectoryEntry<RecordValue>[] {
    return clone(this.#records.get(matchId) ?? [])
  }

  public deleteMatch(matchId: MatchId): void {
    this.#turns.delete(matchId)
    this.#records.delete(matchId)
  }

  private put<Value extends JsonValue>(
    target: Map<MatchId, StoredTrajectoryEntry<Value>[]>,
    entry: StoredTrajectoryEntry<Value>,
  ): StoredTrajectoryEntry<Value> {
    const values = target.get(entry.matchId) ?? []
    const index = values.findIndex((candidate) => candidate.id === entry.id)
    if (index >= 0) values[index] = clone(entry)
    else values.push(clone(entry))
    target.set(entry.matchId, values)
    return clone(entry)
  }
}

function key(matchId: MatchId, participantId: ParticipantId): string {
  return `${matchId}:${participantId}`
}

function clone<Value>(value: Value): Value {
  return structuredClone(value)
}
