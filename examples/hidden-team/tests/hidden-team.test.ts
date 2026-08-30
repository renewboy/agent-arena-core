import { MatchIdSchema, ObserverSchema } from '@agent-arena/contracts'
import { describe, expect, it } from 'vitest'
import { createHiddenTeamModule, hiddenTeamAction, hiddenTeamSetup } from '../src/index.js'

describe('Hidden Team conformance game', () => {
  it('keeps group secrets private and seals clue and guess barriers', () => {
    const module = createHiddenTeamModule()
    const setup = hiddenTeamSetup()
    const machine = module.create({
      matchId: MatchIdSchema.parse('match-hidden-team'),
      setup,
      seed: 1,
      clock: stableClock(),
    })
    const clue = machine.currentDecision()!
    expect(clue.mode).toBe('barrier')
    expect(clue.actors.map((actor) => actor.participantId)).toEqual([
      'participant-red-one',
      'participant-blue-one',
    ])
    const before = machine.events.length
    expect(() =>
      machine.submit([
        hiddenTeamAction({
          decisionId: clue.id,
          actorId: 'participant-red-one',
          actionType: 'clue.submit',
          payload: { text: 'warm light' },
        }),
      ]),
    ).toThrow(/every barrier actor/)
    expect(machine.events).toHaveLength(before)

    machine.submit([
      hiddenTeamAction({
        decisionId: clue.id,
        actorId: 'participant-blue-one',
        actionType: 'clue.submit',
        payload: { text: 'deep water' },
      }),
      hiddenTeamAction({
        decisionId: clue.id,
        actorId: 'participant-red-one',
        actionType: 'clue.submit',
        payload: { text: 'warm light' },
      }),
    ])
    expect(machine.state.stage).toBe('guess')
    expect(machine.events.slice(-2).map((event) => event.payload)).toEqual([
      { groupId: 'group-red', actorId: 'participant-red-one', text: 'warm light' },
      { groupId: 'group-blue', actorId: 'participant-blue-one', text: 'deep water' },
    ])

    const redView = module.observe(
      machine,
      ObserverSchema.parse({ kind: 'participant', participantId: 'participant-red-two' }),
    )
    const blueView = module.observe(
      machine,
      ObserverSchema.parse({ kind: 'participant', participantId: 'participant-blue-two' }),
    )
    const spectator = module.observe(machine, ObserverSchema.parse({ kind: 'spectator' }))
    expect(redView.facts.ownSecret).toBe('ember')
    expect(blueView.facts.ownSecret).toBe('ocean')
    expect(spectator.facts.ownSecret).toBeNull()
    expect(redView.visibleEventSequences).not.toEqual(blueView.visibleEventSequences)

    const guess = machine.currentDecision()!
    machine.submit([
      hiddenTeamAction({
        decisionId: guess.id,
        actorId: 'participant-red-two',
        actionType: 'guess.submit',
        payload: { targetGroupId: 'group-blue', value: 'ocean' },
      }),
      hiddenTeamAction({
        decisionId: guess.id,
        actorId: 'participant-blue-two',
        actionType: 'guess.submit',
        payload: { targetGroupId: 'group-red', value: 'wrong' },
      }),
    ])
    expect(machine.state.scores).toEqual({ 'group-red': 1, 'group-blue': 0 })
    expect(machine.currentDecision()?.actors.map((actor) => actor.participantId)).toEqual([
      'participant-red-two',
      'participant-blue-two',
    ])
  })

  it('restores a completed game to the same state and outcome', () => {
    const module = createHiddenTeamModule()
    const setup = { ...hiddenTeamSetup(), rounds: 1 }
    const matchId = MatchIdSchema.parse('match-hidden-team')
    const machine = module.create({ matchId, setup, seed: 1, clock: stableClock() })
    const clue = machine.currentDecision()!
    machine.submit(
      clue.actors.map((actor) =>
        hiddenTeamAction({
          decisionId: clue.id,
          actorId: actor.participantId,
          actionType: 'clue.submit',
          payload: { text: `clue-${actor.participantId}` },
        }),
      ),
    )
    const guess = machine.currentDecision()!
    machine.submit([
      hiddenTeamAction({
        decisionId: guess.id,
        actorId: 'participant-red-two',
        actionType: 'guess.submit',
        payload: { targetGroupId: 'group-blue', value: 'ocean' },
      }),
      hiddenTeamAction({
        decisionId: guess.id,
        actorId: 'participant-blue-two',
        actionType: 'guess.submit',
        payload: { targetGroupId: 'group-red', value: 'ember' },
      }),
    ])
    expect(machine.currentDecision()).toBeNull()
    expect(machine.outcome).toEqual({
      winningGroupIds: ['group-red', 'group-blue'],
      scores: { 'group-red': 1, 'group-blue': 1 },
    })

    const restored = module.restore({ matchId, setup, events: machine.events })
    expect(restored.state).toEqual(machine.state)
    expect(restored.outcome).toEqual(machine.outcome)
  })
})

function stableClock(): () => Date {
  let tick = 0
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++))
}
