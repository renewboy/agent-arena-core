import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import {
  DecisionIdSchema,
  GameIdSchema,
  MatchIdSchema,
  ParticipantIdSchema,
  RulesetIdSchema,
  SemanticIdSchema,
  type GameAction,
  type GameEvent,
  type SessionBinding,
  type StoredMatch,
} from '@agent-arena/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { openArenaSqliteStorage } from '../src/index.js'

const roots: string[] = []
const SetupSchema = z.object({ participants: z.array(z.string()) }).strict()
const OutcomeSchema = z.object({ winner: z.string() }).strict()
const DeliverySchema = z.object({ acknowledged: z.number().int().nonnegative() }).strict()
const TurnSchema = z.object({ status: z.string() }).strict()
const RecordSchema = z.object({ kind: z.string() }).strict()

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('SQLite reference storage', () => {
  it('persists and restores matches, events, sessions, delivery, and trajectory', async () => {
    const path = await databasePath()
    const stores = open(path)
    const record = matchRecord()
    expect(stores.matches.create(record)).toEqual(record)
    expect(() => stores.matches.create(record)).toThrow()

    const events = gameEvents()
    stores.matches.appendEvents(record.matchId, events)
    expect(stores.matches.events(record.matchId)).toEqual(events)
    expect(() => stores.matches.appendEvents(record.matchId, [events[1]!])).toThrow(/not next/)
    expect(() =>
      stores.matches.appendEvents(record.matchId, [
        { ...events[0]!, matchId: MatchIdSchema.parse('match-other') },
      ]),
    ).toThrow(/not next/)
    expect(stores.matches.setStatus(record.matchId, 'running')).toMatchObject({
      status: 'running',
      outcome: null,
    })
    expect(
      stores.matches.setStatus(record.matchId, 'ended', { winner: 'participant-one' }),
    ).toMatchObject({
      status: 'ended',
      outcome: { winner: 'participant-one' },
    })
    expect(() => stores.matches.setStatus(MatchIdSchema.parse('match-missing'), 'paused')).toThrow(
      /Unknown Match/,
    )

    const binding = sessionBinding()
    expect(stores.sessions.put(binding)).toEqual(binding)
    const action = gameAction()
    expect(
      stores.sessions.savePendingAction(
        binding.matchId,
        binding.participantId,
        action.decisionId,
        action,
        '2026-01-01T00:00:02.000Z',
      ).pendingAction,
    ).toMatchObject({ decisionId: action.decisionId, action })
    expect(
      stores.sessions.clearPendingAction(binding.matchId, binding.participantId).pendingAction,
    ).toBeNull()
    expect(() =>
      stores.sessions.savePendingAction(
        binding.matchId,
        ParticipantIdSchema.parse('participant-missing'),
        action.decisionId,
        action,
      ),
    ).toThrow(/Missing Session/)

    expect(
      stores.deliveries.put(record.matchId, binding.participantId, { acknowledged: 3 }),
    ).toEqual({
      acknowledged: 3,
    })
    expect(stores.deliveries.get(record.matchId, binding.participantId)).toEqual({
      acknowledged: 3,
    })

    expect(
      stores.trajectory.putTurn({
        matchId: record.matchId,
        id: 'turn-one',
        ownerId: binding.participantId,
        ordinal: 1,
        value: { status: 'running' },
      }).value,
    ).toEqual({ status: 'running' })
    stores.trajectory.putTurn({
      matchId: record.matchId,
      id: 'turn-one',
      ownerId: binding.participantId,
      ordinal: 1,
      value: { status: 'completed' },
    })
    stores.trajectory.putRecord({
      matchId: record.matchId,
      id: 'record-one',
      ownerId: 'system',
      ordinal: 1,
      value: { kind: 'lifecycle' },
    })
    expect(stores.trajectory.turns(record.matchId)[0]?.value).toEqual({ status: 'completed' })
    expect(stores.trajectory.records(record.matchId)[0]?.ownerId).toBe('system')
    stores.close()

    const restored = open(path)
    expect(restored.matches.get(record.matchId)?.outcome).toEqual({ winner: 'participant-one' })
    expect(restored.matches.events(record.matchId)).toEqual(events)
    expect(restored.sessions.get(record.matchId, binding.participantId)?.sessionId).toBe(
      'session-one',
    )
    expect(restored.deliveries.get(record.matchId, binding.participantId)).toEqual({
      acknowledged: 3,
    })
    expect(restored.trajectory.turns(record.matchId)).toHaveLength(1)

    restored.deliveries.deleteMatch(record.matchId)
    restored.trajectory.deleteMatch(record.matchId)
    restored.sessions.deleteMatch(record.matchId)
    expect(restored.deliveries.get(record.matchId, binding.participantId)).toBeNull()
    expect(restored.trajectory.turns(record.matchId)).toEqual([])
    expect(restored.sessions.get(record.matchId, binding.participantId)).toBeNull()
    restored.matches.delete(record.matchId)
    expect(restored.matches.get(record.matchId)).toBeNull()
    restored.close()
  })

  it('uses module-scoped migrations and rejects unsupported future schemas', async () => {
    const path = await databasePath()
    const first = open(path)
    first.close()
    const raw = new Database(path)
    expect(
      raw.prepare('SELECT version FROM arena_schema_migrations ORDER BY version').all(),
    ).toEqual([{ version: 1 }])
    raw
      .prepare('INSERT INTO arena_schema_migrations(version, applied_at) VALUES (?, ?)')
      .run(2, '2026-01-01T00:00:00.000Z')
    raw.close()
    expect(() => open(path)).toThrow(/newer than supported/)
  })

  it('fails closed when persisted codecs or binding states are invalid', async () => {
    const path = await databasePath()
    const stores = open(path)
    stores.matches.create(matchRecord())
    stores.sessions.put(sessionBinding())
    stores.close()

    const raw = new Database(path)
    raw
      .prepare(
        'UPDATE arena_session_bindings SET binding_json = ? WHERE match_id = ? AND participant_id = ?',
      )
      .run(
        JSON.stringify({ ...sessionBinding(), state: 'broken' }),
        sessionBinding().matchId,
        sessionBinding().participantId,
      )
    raw.close()
    const reopened = open(path)
    expect(() =>
      reopened.sessions.get(sessionBinding().matchId, sessionBinding().participantId),
    ).toThrow(/Unknown Session binding state/)
    reopened.close()
  })
})

function open(path: string) {
  return openArenaSqliteStorage(path, {
    setup: SetupSchema,
    outcome: OutcomeSchema,
    delivery: DeliverySchema,
    turn: TurnSchema,
    record: RecordSchema,
  })
}

async function databasePath(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'arena-storage-'))
  roots.push(root)
  return resolve(root, 'arena.sqlite')
}

function matchRecord(): StoredMatch<z.infer<typeof SetupSchema>, z.infer<typeof OutcomeSchema>> {
  return {
    matchId: MatchIdSchema.parse('match-storage'),
    gameId: GameIdSchema.parse('game-storage'),
    ruleset: {
      id: RulesetIdSchema.parse('ruleset-storage'),
      revision: 1,
      plugins: [],
      fingerprint: 'a'.repeat(64),
    },
    setup: { participants: ['participant-one'] },
    status: 'created',
    outcome: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function sessionBinding(): SessionBinding {
  return {
    matchId: MatchIdSchema.parse('match-storage'),
    participantId: ParticipantIdSchema.parse('participant-one'),
    state: 'active',
    sessionId: 'session-one',
    sessionGeneration: 1,
    bootstrapState: 'acknowledged',
    pendingAction: null,
  }
}

function gameAction(): GameAction {
  return {
    matchId: MatchIdSchema.parse('match-storage'),
    decisionId: DecisionIdSchema.parse('decision-storage'),
    actorId: ParticipantIdSchema.parse('participant-one'),
    actionType: SemanticIdSchema.parse('action.storage'),
    payload: { value: 1 },
  }
}

function gameEvents(): GameEvent[] {
  return [1, 2].map((sequence) => ({
    matchId: MatchIdSchema.parse('match-storage'),
    sequence,
    occurredAt: `2026-01-01T00:00:0${sequence}.000Z`,
    eventType: SemanticIdSchema.parse('event.storage'),
    schemaVersion: 1,
    audience: { kind: 'public' as const },
    payload: { sequence },
  }))
}
