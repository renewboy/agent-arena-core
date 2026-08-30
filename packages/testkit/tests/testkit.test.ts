import {
  GameIdSchema,
  MatchIdSchema,
  ParticipantIdSchema,
  RulesetIdSchema,
  SemanticIdSchema,
  type GameEvent,
} from '@agent-arena/contracts'
import { describe, expect, it } from 'vitest'
import {
  MemoryDeliveryStore,
  MemoryMatchStore,
  MemorySessionBindingStore,
  MemoryTrajectoryStore,
  ScriptedParticipantDriver,
} from '../src/index.js'

describe('runtime testkit stores', () => {
  it('provides isolated in-memory Match, delivery, trajectory, and Session stores', () => {
    const matchId = MatchIdSchema.parse('match-testkit')
    const participantId = ParticipantIdSchema.parse('participant-one')
    const matches = new MemoryMatchStore<{ value: number }, { winner: string }>()
    const record = {
      matchId,
      gameId: GameIdSchema.parse('game-testkit'),
      ruleset: {
        id: RulesetIdSchema.parse('ruleset-testkit'),
        revision: 1,
        plugins: [],
        fingerprint: 'a'.repeat(64),
      },
      setup: { value: 1 },
      status: 'created' as const,
      outcome: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    expect(matches.create(record)).toEqual(record)
    expect(() => matches.create(record)).toThrow(/already exists/)
    const mutable = matches.get(matchId)!
    mutable.setup.value = 2
    expect(matches.get(matchId)?.setup.value).toBe(1)
    expect(matches.setStatus(matchId, 'ended', { winner: 'participant-one' }).outcome).toEqual({
      winner: 'participant-one',
    })
    expect(() => matches.setStatus(MatchIdSchema.parse('match-missing'), 'running')).toThrow(
      /Unknown Match/,
    )

    const events = [event(matchId, 1), event(matchId, 2)]
    matches.appendEvents(matchId, events)
    expect(matches.events(matchId)).toEqual(events)
    expect(() => matches.appendEvents(matchId, [event(matchId, 2)])).toThrow(/not next/)

    const deliveries = new MemoryDeliveryStore<{ acknowledged: number }>()
    expect(deliveries.put(matchId, participantId, { acknowledged: 1 })).toEqual({ acknowledged: 1 })
    expect(deliveries.get(matchId, participantId)).toEqual({ acknowledged: 1 })
    deliveries.deleteMatch(matchId)
    expect(deliveries.get(matchId, participantId)).toBeNull()

    const trajectory = new MemoryTrajectoryStore<{ status: string }, { kind: string }>()
    trajectory.putTurn({
      matchId,
      id: 'turn-one',
      ownerId: participantId,
      ordinal: 1,
      value: { status: 'running' },
    })
    trajectory.putTurn({
      matchId,
      id: 'turn-one',
      ownerId: participantId,
      ordinal: 1,
      value: { status: 'completed' },
    })
    trajectory.putRecord({
      matchId,
      id: 'record-one',
      ownerId: 'system',
      ordinal: 1,
      value: { kind: 'message' },
    })
    expect(trajectory.turns(matchId)[0]?.value.status).toBe('completed')
    expect(trajectory.records(matchId)).toHaveLength(1)
    trajectory.deleteMatch(matchId)
    expect(trajectory.turns(matchId)).toEqual([])

    const sessions = new MemorySessionBindingStore()
    expect(() => sessions.clearPendingAction(matchId, participantId)).toThrow(/Missing Session/)
    sessions.put({
      matchId,
      participantId,
      state: 'active',
      sessionId: 'session-one',
      sessionGeneration: 1,
      bootstrapState: 'acknowledged',
      pendingAction: null,
    })
    sessions.deleteMatch(matchId)
    expect(sessions.get(matchId, participantId)).toBeNull()

    matches.delete(matchId)
    expect(matches.get(matchId)).toBeNull()
  })

  it('fails when a scripted participant has no remaining decision', async () => {
    const driver = new ScriptedParticipantDriver(new Map())
    await expect(driver.takeTurn({ participantId: 'participant-one' } as never)).rejects.toThrow(
      /No scripted decision/,
    )
  })
})

function event(matchId: ReturnType<typeof MatchIdSchema.parse>, sequence: number): GameEvent {
  return {
    matchId,
    sequence,
    occurredAt: `2026-01-01T00:00:0${sequence}.000Z`,
    eventType: SemanticIdSchema.parse('event.testkit'),
    schemaVersion: 1,
    audience: { kind: 'public' },
    payload: { sequence },
  }
}
