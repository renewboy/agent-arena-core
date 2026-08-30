import { MatchIdSchema, ObserverSchema } from '@agent-arena/contracts'
import { describe, expect, it } from 'vitest'
import { createReactionCardModule, reactionCardAction, reactionCardSetup } from '../src/index.js'

describe('Reaction Card conformance game', () => {
  it('keeps hands private and restores an active nested response window', () => {
    const module = createReactionCardModule()
    const setup = reactionCardSetup(['focus', 'guard', 'strike', 'guard', 'focus', 'strike'])
    const matchId = MatchIdSchema.parse('match-reaction-card')
    const machine = module.create({ matchId, setup, seed: 1, clock: stableClock() })
    expect(machine.state.hands).toEqual({
      'participant-one': ['focus'],
      'participant-two': ['guard'],
    })
    const one = module.observe(
      machine,
      ObserverSchema.parse({ kind: 'participant', participantId: 'participant-one' }),
    )
    const two = module.observe(
      machine,
      ObserverSchema.parse({ kind: 'participant', participantId: 'participant-two' }),
    )
    const spectator = module.observe(machine, ObserverSchema.parse({ kind: 'spectator' }))
    expect(one.facts.hand).toEqual(['focus'])
    expect(two.facts.hand).toEqual(['guard'])
    expect(spectator.facts.hand).toEqual([])
    expect(one.visibleEventSequences).not.toEqual(two.visibleEventSequences)

    const focus = machine.currentDecision()!
    machine.submit([
      reactionCardAction({
        decisionId: focus.id,
        actorId: 'participant-one',
        actionType: 'card.play',
        payload: { card: 'focus' },
      }),
    ])
    expect(machine.currentDecision()?.actors[0]?.participantId).toBe('participant-one')
    expect(machine.state.hands['participant-one']).toEqual(['strike'])

    const strike = machine.currentDecision()!
    machine.submit([
      reactionCardAction({
        decisionId: strike.id,
        actorId: 'participant-one',
        actionType: 'card.play',
        payload: { card: 'strike' },
      }),
    ])
    expect(machine.state.stage).toBe('response')
    expect(machine.currentDecision()?.actors[0]?.participantId).toBe('participant-two')

    const restored = module.restore({ matchId, setup, events: machine.events })
    expect(restored.state).toEqual(machine.state)
    const response = restored.currentDecision()!
    restored.submit([
      reactionCardAction({
        decisionId: response.id,
        actorId: 'participant-two',
        actionType: 'card.respond',
        payload: { card: 'guard' },
      }),
    ])
    expect(restored.state.stage).toBe('main')
    expect(restored.state.health).toEqual({ 'participant-one': 2, 'participant-two': 2 })
    expect(restored.currentDecision()?.actors[0]?.participantId).toBe('participant-one')
  })

  it('resolves an unblocked response into a deterministic terminal outcome', () => {
    const module = createReactionCardModule()
    const setup = {
      ...reactionCardSetup(['strike', 'focus', 'guard', 'focus']),
      startingHealth: 1,
    }
    const matchId = MatchIdSchema.parse('match-reaction-card')
    const machine = module.create({ matchId, setup, seed: 1, clock: stableClock() })
    const strike = machine.currentDecision()!
    machine.submit([
      reactionCardAction({
        decisionId: strike.id,
        actorId: 'participant-one',
        actionType: 'card.play',
        payload: { card: 'strike' },
      }),
    ])
    const response = machine.currentDecision()!
    machine.submit([
      reactionCardAction({
        decisionId: response.id,
        actorId: 'participant-two',
        actionType: 'response.pass',
      }),
    ])
    expect(machine.currentDecision()).toBeNull()
    expect(machine.outcome).toEqual({
      winnerId: 'participant-one',
      health: { 'participant-one': 1, 'participant-two': 0 },
    })
    expect(module.restore({ matchId, setup, events: machine.events }).outcome).toEqual(
      machine.outcome,
    )
  })

  it('uses the seed for a stable default deck and rejects cards outside the hand', () => {
    const module = createReactionCardModule()
    const setup = reactionCardSetup()
    const first = module.create({
      matchId: MatchIdSchema.parse('match-reaction-card'),
      setup,
      seed: 42,
      clock: stableClock(),
    })
    const second = module.create({
      matchId: MatchIdSchema.parse('match-reaction-card'),
      setup,
      seed: 42,
      clock: stableClock(),
    })
    expect(first.state).toEqual(second.state)
    const decision = first.currentDecision()!
    expect(() =>
      first.submit([
        reactionCardAction({
          decisionId: decision.id,
          actorId: 'participant-one',
          actionType: 'card.play',
          payload: {
            card: first.state.hands['participant-one']?.[0] === 'focus' ? 'strike' : 'focus',
          },
        }),
      ]),
    ).toThrow(/does not hold/)
  })
})

function stableClock(): () => Date {
  let tick = 0
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++))
}
