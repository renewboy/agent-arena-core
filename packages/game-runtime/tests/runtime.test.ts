import { z } from 'zod'
import {
  DecisionIdSchema,
  MatchIdSchema,
  ParticipantIdSchema,
  SemanticIdSchema,
  type GameAction,
} from '@agent-arena/contracts'
import { describe, expect, it } from 'vitest'
import {
  EventJournal,
  RuleViolation,
  SeededRandom,
  decisionDescriptor,
  deterministicIndex,
  shuffled,
  validateDecisionBatch,
  type DecisionBoundary,
} from '../src/index.js'

function action(actorId: string, payload: unknown = { choice: 'yes' }): GameAction {
  return {
    matchId: MatchIdSchema.parse('match-runtime'),
    decisionId: DecisionIdSchema.parse('decision-vote'),
    actorId: ParticipantIdSchema.parse(actorId),
    actionType: SemanticIdSchema.parse('vote.submit'),
    payload: payload as never,
  }
}

function barrier(): DecisionBoundary {
  const spec = {
    actionType: SemanticIdSchema.parse('vote.submit'),
    toolName: 'submit_vote',
    inputMode: 'structured' as const,
    schema: z.object({ choice: z.enum(['yes', 'no']) }),
  }
  return {
    id: DecisionIdSchema.parse('decision-vote'),
    kind: SemanticIdSchema.parse('vote.submit'),
    mode: 'barrier',
    observationRevision: 3,
    actors: ['participant-one', 'participant-two'].map((participantId) => ({
      participantId: ParticipantIdSchema.parse(participantId),
      actions: [spec],
    })),
  }
}

describe('decision boundary', () => {
  it('validates and returns barrier actions in declared actor order', () => {
    const boundary = barrier()
    expect(decisionDescriptor(boundary)).toMatchObject({ mode: 'barrier' })
    expect(
      validateDecisionBatch(boundary, [action('participant-two'), action('participant-one')]).map(
        (entry) => entry.actorId,
      ),
    ).toEqual(['participant-one', 'participant-two'])
  })

  it('rejects missing, duplicate, unavailable, stale, and malformed actions', () => {
    const boundary = barrier()
    expect(() => validateDecisionBatch(boundary, [action('participant-one')])).toThrow(
      /every barrier actor/,
    )
    expect(() =>
      validateDecisionBatch(boundary, [action('participant-one'), action('participant-one')]),
    ).toThrow(/more than one action/)
    expect(() => validateDecisionBatch(boundary, [action('participant-three')])).toThrow(
      /not an actor/,
    )
    expect(() =>
      validateDecisionBatch(boundary, [
        { ...action('participant-one'), actionType: SemanticIdSchema.parse('vote.other') },
      ]),
    ).toThrow(/unavailable/)
    expect(() =>
      validateDecisionBatch(boundary, [
        { ...action('participant-one'), decisionId: DecisionIdSchema.parse('decision-other') },
      ]),
    ).toThrow(/not active/)
    expect(() =>
      validateDecisionBatch(boundary, [action('participant-one', { choice: 1 })]),
    ).toThrow(/payload is invalid/)

    const single = { ...boundary, mode: 'single' as const, actors: boundary.actors.slice(0, 1) }
    expect(() => validateDecisionBatch(single, [])).toThrow(/requires one action/)
  })
})

describe('event journal and deterministic utilities', () => {
  it('appends, reduces, and restores one deterministic event sequence', () => {
    const matchId = MatchIdSchema.parse('match-runtime')
    let tick = 0
    const reducer = (state: number, event: { payload: unknown }): number =>
      state + Number((event.payload as { value: number }).value)
    const journal = new EventJournal({
      matchId,
      initialState: 0,
      reducer,
      clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
    })
    journal.appendAll([
      {
        eventType: SemanticIdSchema.parse('score.added'),
        schemaVersion: 1,
        audience: { kind: 'public' },
        payload: { value: 2 },
      },
      {
        eventType: SemanticIdSchema.parse('score.added'),
        schemaVersion: 1,
        audience: { kind: 'host' },
        payload: { value: 3 },
      },
    ])
    expect(journal.state).toBe(5)
    expect(journal.revision).toBe(2)
    expect(journal.replay()).toBe(5)

    const restored = new EventJournal({
      matchId,
      initialState: 0,
      reducer,
      events: journal.events,
    })
    expect(restored.state).toBe(5)
    expect(
      () =>
        new EventJournal({
          matchId,
          initialState: 0,
          reducer,
          events: [{ ...journal.events[0]!, sequence: 2 }],
        }),
    ).toThrow(/not next/)
    expect(
      () =>
        new EventJournal({
          matchId: MatchIdSchema.parse('match-other'),
          initialState: 0,
          reducer,
          events: journal.events,
        }),
    ).toThrow(/another Match/)
  })

  it('keeps seeded selection and shuffling stable', () => {
    expect(deterministicIndex('stable-key', 7)).toBe(deterministicIndex('stable-key', 7))
    expect(() => deterministicIndex('empty', 0)).toThrow(RuleViolation)
    const first = new SeededRandom(42)
    const second = new SeededRandom(42)
    expect([first.next(), first.next()]).toEqual([second.next(), second.next()])
    expect(first.state).toBe(second.state)
    expect(shuffled([1, 2, 3, 4], new SeededRandom(7))).toEqual(
      shuffled([1, 2, 3, 4], new SeededRandom(7)),
    )
    expect(new SeededRandom(0).state).toBe(0x9e37_79b9)
    expect(shuffled([1], new SeededRandom(1))).toEqual([1])
  })
})
