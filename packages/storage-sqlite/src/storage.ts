import Database from 'better-sqlite3'
import {
  DecisionIdSchema,
  GameActionSchema,
  GameEventSchema,
  GameIdSchema,
  MatchIdSchema,
  ParticipantIdSchema,
  RulesetLockSchema,
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
  type ValueCodec,
} from '@agent-arena/contracts'

const schemaVersion = 1

export interface ArenaSqliteCodecs<
  Setup extends JsonValue,
  Outcome extends JsonValue,
  Delivery extends JsonValue,
  Turn extends JsonValue,
  RecordValue extends JsonValue,
> {
  readonly setup: ValueCodec<Setup>
  readonly outcome: ValueCodec<Outcome>
  readonly delivery: ValueCodec<Delivery>
  readonly turn: ValueCodec<Turn>
  readonly record: ValueCodec<RecordValue>
}

export interface ArenaSqliteStores<
  Setup extends JsonValue,
  Outcome extends JsonValue,
  Delivery extends JsonValue,
  Turn extends JsonValue,
  RecordValue extends JsonValue,
> {
  readonly matches: MatchStore<Setup, Outcome>
  readonly sessions: SessionBindingStore
  readonly deliveries: DeliveryStore<Delivery>
  readonly trajectory: TrajectoryStore<Turn, RecordValue>
  close(): void
}

export function openArenaSqliteStorage<
  Setup extends JsonValue,
  Outcome extends JsonValue,
  Delivery extends JsonValue,
  Turn extends JsonValue,
  RecordValue extends JsonValue,
>(
  path: string,
  codecs: ArenaSqliteCodecs<Setup, Outcome, Delivery, Turn, RecordValue>,
): ArenaSqliteStores<Setup, Outcome, Delivery, Turn, RecordValue> {
  const database = new Database(path)
  try {
    database.pragma('foreign_keys = ON')
    migrate(database)
  } catch (error) {
    database.close()
    throw error
  }
  return {
    matches: new SqliteMatchStore(database, codecs),
    sessions: new SqliteSessionBindingStore(database),
    deliveries: new SqliteDeliveryStore(database, codecs.delivery),
    trajectory: new SqliteTrajectoryStore(database, codecs.turn, codecs.record),
    close: () => database.close(),
  }
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS arena_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)
  const current = database
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM arena_schema_migrations')
    .get() as { version: number }
  if (current.version > schemaVersion) {
    throw new Error(
      `Arena SQLite schema ${current.version} is newer than supported ${schemaVersion}`,
    )
  }
  if (current.version === 0) {
    database.transaction(() => {
      database.exec(`
        CREATE TABLE arena_matches (
          match_id TEXT PRIMARY KEY,
          game_id TEXT NOT NULL,
          ruleset_json TEXT NOT NULL,
          setup_json TEXT NOT NULL,
          status TEXT NOT NULL,
          outcome_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE arena_events (
          match_id TEXT NOT NULL REFERENCES arena_matches(match_id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL,
          event_json TEXT NOT NULL,
          PRIMARY KEY (match_id, sequence)
        );
        CREATE TABLE arena_session_bindings (
          match_id TEXT NOT NULL REFERENCES arena_matches(match_id) ON DELETE CASCADE,
          participant_id TEXT NOT NULL,
          binding_json TEXT NOT NULL,
          PRIMARY KEY (match_id, participant_id)
        );
        CREATE TABLE arena_delivery_ledgers (
          match_id TEXT NOT NULL REFERENCES arena_matches(match_id) ON DELETE CASCADE,
          participant_id TEXT NOT NULL,
          ledger_json TEXT NOT NULL,
          PRIMARY KEY (match_id, participant_id)
        );
        CREATE TABLE arena_trajectory_turns (
          match_id TEXT NOT NULL REFERENCES arena_matches(match_id) ON DELETE CASCADE,
          entry_id TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          ordinal INTEGER NOT NULL,
          value_json TEXT NOT NULL,
          PRIMARY KEY (match_id, entry_id),
          UNIQUE (match_id, owner_id, ordinal)
        );
        CREATE TABLE arena_trajectory_records (
          match_id TEXT NOT NULL REFERENCES arena_matches(match_id) ON DELETE CASCADE,
          entry_id TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          ordinal INTEGER NOT NULL,
          value_json TEXT NOT NULL,
          PRIMARY KEY (match_id, entry_id),
          UNIQUE (match_id, owner_id, ordinal)
        );
      `)
      database
        .prepare('INSERT INTO arena_schema_migrations(version, applied_at) VALUES (?, ?)')
        .run(schemaVersion, new Date().toISOString())
    })()
  }
}

class SqliteMatchStore<
  Setup extends JsonValue,
  Outcome extends JsonValue,
  Delivery extends JsonValue,
  Turn extends JsonValue,
  RecordValue extends JsonValue,
> implements MatchStore<Setup, Outcome> {
  public constructor(
    private readonly database: Database.Database,
    private readonly codecs: ArenaSqliteCodecs<Setup, Outcome, Delivery, Turn, RecordValue>,
  ) {}

  public create(record: StoredMatch<Setup, Outcome>): StoredMatch<Setup, Outcome> {
    this.database
      .prepare(
        `INSERT INTO arena_matches(
          match_id, game_id, ruleset_json, setup_json, status, outcome_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.matchId,
        record.gameId,
        encode(record.ruleset),
        encode(this.codecs.setup.parse(record.setup)),
        record.status,
        record.outcome === null ? null : encode(this.codecs.outcome.parse(record.outcome)),
        record.createdAt,
        record.updatedAt,
      )
    return this.get(record.matchId)!
  }

  public get(matchId: MatchId): StoredMatch<Setup, Outcome> | null {
    const row = this.database
      .prepare('SELECT * FROM arena_matches WHERE match_id = ?')
      .get(matchId) as MatchRow | undefined
    return row ? this.parse(row) : null
  }

  public setStatus(
    matchId: MatchId,
    status: MatchRuntimeStatus,
    outcome?: Outcome | null,
  ): StoredMatch<Setup, Outcome> {
    const existing = this.get(matchId)
    if (!existing) throw new Error(`Unknown Match ${matchId}`)
    const nextOutcome = outcome === undefined ? existing.outcome : outcome
    this.database
      .prepare(
        'UPDATE arena_matches SET status = ?, outcome_json = ?, updated_at = ? WHERE match_id = ?',
      )
      .run(
        status,
        nextOutcome === null ? null : encode(this.codecs.outcome.parse(nextOutcome)),
        new Date().toISOString(),
        matchId,
      )
    return this.get(matchId)!
  }

  public appendEvents(matchId: MatchId, events: readonly GameEvent[]): void {
    const insert = this.database.prepare(
      'INSERT INTO arena_events(match_id, sequence, event_json) VALUES (?, ?, ?)',
    )
    this.database.transaction(() => {
      const previous = this.database
        .prepare(
          'SELECT COALESCE(MAX(sequence), 0) AS sequence FROM arena_events WHERE match_id = ?',
        )
        .get(matchId) as { sequence: number }
      for (const [index, input] of events.entries()) {
        const event = GameEventSchema.parse(input)
        if (event.matchId !== matchId || event.sequence !== previous.sequence + index + 1) {
          throw new Error(`Event ${event.sequence} is not next for Match ${matchId}`)
        }
        insert.run(matchId, event.sequence, encode(event))
      }
    })()
  }

  public events(matchId: MatchId): readonly GameEvent[] {
    const rows = this.database
      .prepare('SELECT event_json FROM arena_events WHERE match_id = ? ORDER BY sequence')
      .all(matchId) as Array<{ event_json: string }>
    return rows.map((row) => GameEventSchema.parse(decode(row.event_json)))
  }

  public delete(matchId: MatchId): void {
    this.database.prepare('DELETE FROM arena_matches WHERE match_id = ?').run(matchId)
  }

  private parse(row: MatchRow): StoredMatch<Setup, Outcome> {
    return {
      matchId: MatchIdSchema.parse(row.match_id),
      gameId: GameIdSchema.parse(row.game_id),
      ruleset: RulesetLockSchema.parse(decode(row.ruleset_json)),
      setup: this.codecs.setup.parse(decode(row.setup_json)),
      status: parseStatus(row.status),
      outcome: row.outcome_json ? this.codecs.outcome.parse(decode(row.outcome_json)) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

class SqliteSessionBindingStore implements SessionBindingStore {
  public constructor(private readonly database: Database.Database) {}

  public get(matchId: MatchId, participantId: ParticipantId): SessionBinding | null {
    const row = this.database
      .prepare(
        'SELECT binding_json FROM arena_session_bindings WHERE match_id = ? AND participant_id = ?',
      )
      .get(matchId, participantId) as { binding_json: string } | undefined
    return row ? parseBinding(decode(row.binding_json)) : null
  }

  public put(binding: SessionBinding): SessionBinding {
    const parsed = parseBinding(binding)
    this.database
      .prepare(
        `INSERT INTO arena_session_bindings(match_id, participant_id, binding_json)
         VALUES (?, ?, ?)
         ON CONFLICT(match_id, participant_id) DO UPDATE SET binding_json = excluded.binding_json`,
      )
      .run(parsed.matchId, parsed.participantId, encode(parsed))
    return this.get(parsed.matchId, parsed.participantId)!
  }

  public savePendingAction(
    matchId: MatchId,
    participantId: ParticipantId,
    decisionId: ReturnType<typeof DecisionIdSchema.parse>,
    action: GameAction,
    acceptedAt = new Date().toISOString(),
  ): SessionBinding {
    const binding = this.get(matchId, participantId)
    if (!binding) throw new Error(`Missing Session binding ${matchId}/${participantId}`)
    return this.put({
      ...binding,
      pendingAction: {
        decisionId: DecisionIdSchema.parse(decisionId),
        action: GameActionSchema.parse(action),
        acceptedAt,
      },
    })
  }

  public clearPendingAction(matchId: MatchId, participantId: ParticipantId): SessionBinding {
    const binding = this.get(matchId, participantId)
    if (!binding) throw new Error(`Missing Session binding ${matchId}/${participantId}`)
    return this.put({ ...binding, pendingAction: null })
  }

  public deleteMatch(matchId: MatchId): void {
    this.database.prepare('DELETE FROM arena_session_bindings WHERE match_id = ?').run(matchId)
  }
}

class SqliteDeliveryStore<Snapshot extends JsonValue> implements DeliveryStore<Snapshot> {
  public constructor(
    private readonly database: Database.Database,
    private readonly codec: ValueCodec<Snapshot>,
  ) {}

  public get(matchId: MatchId, participantId: ParticipantId): Snapshot | null {
    const row = this.database
      .prepare(
        'SELECT ledger_json FROM arena_delivery_ledgers WHERE match_id = ? AND participant_id = ?',
      )
      .get(matchId, participantId) as { ledger_json: string } | undefined
    return row ? this.codec.parse(decode(row.ledger_json)) : null
  }

  public put(matchId: MatchId, participantId: ParticipantId, snapshot: Snapshot): Snapshot {
    const parsed = this.codec.parse(snapshot)
    this.database
      .prepare(
        `INSERT INTO arena_delivery_ledgers(match_id, participant_id, ledger_json)
         VALUES (?, ?, ?)
         ON CONFLICT(match_id, participant_id) DO UPDATE SET ledger_json = excluded.ledger_json`,
      )
      .run(matchId, participantId, encode(parsed))
    return this.get(matchId, participantId)!
  }

  public deleteMatch(matchId: MatchId): void {
    this.database.prepare('DELETE FROM arena_delivery_ledgers WHERE match_id = ?').run(matchId)
  }
}

class SqliteTrajectoryStore<
  Turn extends JsonValue,
  RecordValue extends JsonValue,
> implements TrajectoryStore<Turn, RecordValue> {
  public constructor(
    private readonly database: Database.Database,
    private readonly turnCodec: ValueCodec<Turn>,
    private readonly recordCodec: ValueCodec<RecordValue>,
  ) {}

  public putTurn(entry: StoredTrajectoryEntry<Turn>): StoredTrajectoryEntry<Turn> {
    return this.put('arena_trajectory_turns', entry, this.turnCodec)
  }

  public putRecord(entry: StoredTrajectoryEntry<RecordValue>): StoredTrajectoryEntry<RecordValue> {
    return this.put('arena_trajectory_records', entry, this.recordCodec)
  }

  public turns(matchId: MatchId): readonly StoredTrajectoryEntry<Turn>[] {
    return this.list('arena_trajectory_turns', matchId, this.turnCodec)
  }

  public records(matchId: MatchId): readonly StoredTrajectoryEntry<RecordValue>[] {
    return this.list('arena_trajectory_records', matchId, this.recordCodec)
  }

  public deleteMatch(matchId: MatchId): void {
    this.database.prepare('DELETE FROM arena_trajectory_turns WHERE match_id = ?').run(matchId)
    this.database.prepare('DELETE FROM arena_trajectory_records WHERE match_id = ?').run(matchId)
  }

  private put<Value extends JsonValue>(
    table: 'arena_trajectory_turns' | 'arena_trajectory_records',
    entry: StoredTrajectoryEntry<Value>,
    codec: ValueCodec<Value>,
  ): StoredTrajectoryEntry<Value> {
    const value = codec.parse(entry.value)
    this.database
      .prepare(
        `INSERT INTO ${table}(match_id, entry_id, owner_id, ordinal, value_json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(match_id, entry_id) DO UPDATE SET
           owner_id = excluded.owner_id,
           ordinal = excluded.ordinal,
           value_json = excluded.value_json`,
      )
      .run(entry.matchId, entry.id, entry.ownerId, entry.ordinal, encode(value))
    return { ...entry, value }
  }

  private list<Value extends JsonValue>(
    table: 'arena_trajectory_turns' | 'arena_trajectory_records',
    matchId: MatchId,
    codec: ValueCodec<Value>,
  ): StoredTrajectoryEntry<Value>[] {
    const rows = this.database
      .prepare(
        `SELECT match_id, entry_id, owner_id, ordinal, value_json
         FROM ${table} WHERE match_id = ? ORDER BY owner_id, ordinal`,
      )
      .all(matchId) as TrajectoryRow[]
    return rows.map((row) => ({
      matchId: MatchIdSchema.parse(row.match_id),
      id: row.entry_id,
      ownerId: row.owner_id === 'system' ? 'system' : ParticipantIdSchema.parse(row.owner_id),
      ordinal: row.ordinal,
      value: codec.parse(decode(row.value_json)),
    }))
  }
}

interface MatchRow {
  readonly match_id: string
  readonly game_id: string
  readonly ruleset_json: string
  readonly setup_json: string
  readonly status: string
  readonly outcome_json: string | null
  readonly created_at: string
  readonly updated_at: string
}

interface TrajectoryRow {
  readonly match_id: string
  readonly entry_id: string
  readonly owner_id: string
  readonly ordinal: number
  readonly value_json: string
}

function parseStatus(value: string): MatchRuntimeStatus {
  if (value === 'created' || value === 'running' || value === 'paused' || value === 'ended') {
    return value
  }
  throw new Error(`Unknown Match status ${value}`)
}

function parseBinding(input: unknown): SessionBinding {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Session binding must be an object')
  }
  const value = input as Record<string, unknown>
  const state = value['state']
  const bootstrapState = value['bootstrapState']
  if (state !== 'creating' && state !== 'active' && state !== 'closed') {
    throw new Error(`Unknown Session binding state ${String(state)}`)
  }
  if (
    bootstrapState !== 'pending' &&
    bootstrapState !== 'dispatched' &&
    bootstrapState !== 'acknowledged'
  ) {
    throw new Error(`Unknown Session bootstrap state ${String(bootstrapState)}`)
  }
  const pending = value['pendingAction']
  const sessionId = value['sessionId']
  if (sessionId !== null && typeof sessionId !== 'string') {
    throw new Error('Session ID must be a string or null')
  }
  return {
    matchId: MatchIdSchema.parse(value['matchId']),
    participantId: ParticipantIdSchema.parse(value['participantId']),
    state,
    sessionId,
    sessionGeneration: positiveInteger(value['sessionGeneration'], 'sessionGeneration'),
    bootstrapState,
    pendingAction: pending === null ? null : parsePendingAction(pending),
  }
}

function parsePendingAction(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Pending action must be an object')
  }
  const value = input as Record<string, unknown>
  if (typeof value['acceptedAt'] !== 'string') {
    throw new Error('Pending action acceptedAt must be a string')
  }
  return {
    decisionId: DecisionIdSchema.parse(value['decisionId']),
    action: GameActionSchema.parse(value['action']),
    acceptedAt: value['acceptedAt'],
  }
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${label} must be positive`)
  return Number(value)
}

function encode(value: unknown): string {
  return JSON.stringify(value)
}

function decode(value: string): unknown {
  return JSON.parse(value)
}
