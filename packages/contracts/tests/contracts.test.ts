import { describe, expect, it } from 'vitest'
import {
  AudienceSchema,
  DecisionBoundaryDescriptorSchema,
  GameActionSchema,
  GameEventSchema,
  ObserverSchema,
  RulesetLockSchema,
  canObserve,
} from '../src/index.js'

describe('core contracts', () => {
  it('parses generic actions, events, and Ruleset locks', () => {
    expect(
      GameActionSchema.parse({
        matchId: 'match-demo',
        decisionId: 'decision-one',
        actorId: 'participant-one',
        actionType: 'card.play',
        payload: { cardId: 'card-one' },
      }),
    ).toMatchObject({ actionType: 'card.play' })
    expect(
      GameEventSchema.parse({
        matchId: 'match-demo',
        sequence: 1,
        occurredAt: '2026-01-01T00:00:00.000Z',
        eventType: 'match.started',
        schemaVersion: 1,
        audience: { kind: 'public' },
        payload: {},
      }),
    ).toMatchObject({ sequence: 1 })
    expect(
      RulesetLockSchema.parse({
        id: 'ruleset-demo',
        revision: 1,
        plugins: [],
        fingerprint: 'a'.repeat(64),
      }),
    ).toMatchObject({ id: 'ruleset-demo' })
  })

  it('validates decision actor and action-type uniqueness', () => {
    const valid = DecisionBoundaryDescriptorSchema.parse({
      id: 'decision-vote',
      kind: 'vote.submit',
      mode: 'barrier',
      observationRevision: 4,
      actors: [
        { participantId: 'participant-one', actionTypes: ['vote.submit'] },
        { participantId: 'participant-two', actionTypes: ['vote.submit'] },
      ],
    })
    expect(valid.actors).toHaveLength(2)
    for (const invalid of [
      { ...valid, mode: 'single', actors: valid.actors },
      { ...valid, actors: [valid.actors[0], valid.actors[0]] },
      {
        ...valid,
        actors: [{ participantId: 'participant-one', actionTypes: ['vote.submit', 'vote.submit'] }],
      },
    ]) {
      expect(() => DecisionBoundaryDescriptorSchema.parse(invalid)).toThrow()
    }
  })

  it('enforces public, host, participant, and group audiences', () => {
    const host = ObserverSchema.parse({ kind: 'host' })
    const spectator = ObserverSchema.parse({ kind: 'spectator' })
    const participant = ObserverSchema.parse({
      kind: 'participant',
      participantId: 'participant-one',
    })
    const publicAudience = AudienceSchema.parse({ kind: 'public' })
    const hostAudience = AudienceSchema.parse({ kind: 'host' })
    const participantAudience = AudienceSchema.parse({
      kind: 'participants',
      participantIds: ['participant-one'],
    })
    const groupAudience = AudienceSchema.parse({ kind: 'group', groupId: 'group-red' })
    const groups = new Map([['group-red', new Set(['participant-one'])]])

    expect(canObserve(publicAudience, spectator)).toBe(true)
    expect(canObserve(hostAudience, host)).toBe(true)
    expect(canObserve(hostAudience, participant)).toBe(false)
    expect(canObserve(participantAudience, participant)).toBe(true)
    expect(canObserve(groupAudience, participant, groups)).toBe(true)
    expect(canObserve(groupAudience, spectator, groups)).toBe(false)
    expect(() =>
      AudienceSchema.parse({
        kind: 'participants',
        participantIds: ['participant-one', 'participant-one'],
      }),
    ).toThrow()
  })
})
