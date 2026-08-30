import {
  DecisionIdSchema,
  MatchIdSchema,
  ParticipantIdSchema,
  SemanticIdSchema,
  type ParticipantId,
} from '@agent-arena/contracts'
import { MatchOrchestrator, ActionGateway } from '@agent-arena/match-runtime'
import {
  MemorySessionBindingStore,
  ScriptedParticipantDriver,
  type ScriptedDecision,
} from '@agent-arena/testkit'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createHiddenTeamModule, hiddenTeamSetup } from '../../../examples/hidden-team/src/index.js'
import {
  createReactionCardModule,
  reactionCardSetup,
} from '../../../examples/reaction-card/src/index.js'

describe('Match orchestrator', () => {
  it('seals barrier actions, preserves actor order, and persists before receipts', async () => {
    const module = createHiddenTeamModule()
    const matchId = MatchIdSchema.parse('match-hidden-team')
    const machine = module.create({
      matchId,
      setup: { ...hiddenTeamSetup(), rounds: 1 },
      seed: 1,
      clock: stableClock(),
    })
    const sessions = bindings(matchId, [
      'participant-red-one',
      'participant-blue-one',
      'participant-red-two',
      'participant-blue-two',
    ])
    const scripts = new Map<ParticipantId, readonly ScriptedDecision[]>([
      [
        ParticipantIdSchema.parse('participant-red-one'),
        [{ kind: 'text', text: 'warm', delayMs: 10 }],
      ],
      [
        ParticipantIdSchema.parse('participant-blue-one'),
        [{ kind: 'text', text: 'water', delayMs: 1 }],
      ],
      [
        ParticipantIdSchema.parse('participant-red-two'),
        [
          {
            kind: 'tool',
            toolName: 'submit_guess',
            payload: { targetGroupId: 'group-blue', value: 'ocean' },
          },
        ],
      ],
      [
        ParticipantIdSchema.parse('participant-blue-two'),
        [
          {
            kind: 'tool',
            toolName: 'submit_guess',
            payload: { targetGroupId: 'group-red', value: 'wrong' },
          },
        ],
      ],
    ])
    const driver = new ScriptedParticipantDriver(scripts)
    const orchestrator = new MatchOrchestrator({ module, machine, driver, sessions })
    const clue = await orchestrator.runDecision()
    expect(driver.completionOrder).toEqual(['participant-blue-one', 'participant-red-one'])
    expect(clue?.actions.map((action) => action.actorId)).toEqual([
      'participant-red-one',
      'participant-blue-one',
    ])
    expect(machine.events.slice(-2).map((event) => event.payload)).toEqual([
      { groupId: 'group-red', actorId: 'participant-red-one', text: 'warm' },
      { groupId: 'group-blue', actorId: 'participant-blue-one', text: 'water' },
    ])
    expect(
      sessions.get(matchId, ParticipantIdSchema.parse('participant-red-one'))?.pendingAction,
    ).toBeNull()
    await orchestrator.runDecision()
    expect(machine.outcome?.winningGroupIds).toEqual(['group-red'])
    orchestrator.close()
  })

  it('keeps accepted barrier actions sealed across failure and retry', async () => {
    const module = createHiddenTeamModule()
    const matchId = MatchIdSchema.parse('match-hidden-team')
    const machine = module.create({
      matchId,
      setup: hiddenTeamSetup(),
      seed: 1,
      clock: stableClock(),
    })
    const sessions = bindings(matchId, ['participant-red-one', 'participant-blue-one'])
    const before = machine.events.length
    const failing = new ScriptedParticipantDriver(
      new Map([
        [
          ParticipantIdSchema.parse('participant-red-one'),
          [{ kind: 'text' as const, text: 'warm' }],
        ],
        [
          ParticipantIdSchema.parse('participant-blue-one'),
          [{ kind: 'failure' as const, message: 'transient delivery' }],
        ],
      ]),
    )
    await expect(
      new MatchOrchestrator({ module, machine, driver: failing, sessions }).runDecision(),
    ).rejects.toThrow(/Decision decision-clue-1 failed/)
    expect(machine.events).toHaveLength(before)
    expect(
      sessions.get(matchId, ParticipantIdSchema.parse('participant-red-one'))?.pendingAction,
    ).not.toBeNull()

    const retry = new ScriptedParticipantDriver(
      new Map([
        [
          ParticipantIdSchema.parse('participant-blue-one'),
          [{ kind: 'text' as const, text: 'water' }],
        ],
      ]),
    )
    await new MatchOrchestrator({ module, machine, driver: retry, sessions }).runDecision()
    expect(retry.completionOrder).toEqual(['participant-blue-one'])
    expect(machine.state.stage).toBe('guess')
    expect(
      sessions.get(matchId, ParticipantIdSchema.parse('participant-red-one'))?.pendingAction,
    ).toBeNull()
  })

  it('supports consecutive single decisions and nested response boundaries', async () => {
    const module = createReactionCardModule()
    const matchId = MatchIdSchema.parse('match-reaction-card')
    const machine = module.create({
      matchId,
      setup: reactionCardSetup(['focus', 'guard', 'strike', 'guard', 'focus', 'strike']),
      seed: 1,
      clock: stableClock(),
    })
    const driver = new ScriptedParticipantDriver(
      new Map([
        [
          ParticipantIdSchema.parse('participant-one'),
          [
            { kind: 'tool' as const, toolName: 'play_card', payload: { card: 'focus' } },
            { kind: 'tool' as const, toolName: 'play_card', payload: { card: 'strike' } },
          ],
        ],
        [
          ParticipantIdSchema.parse('participant-two'),
          [{ kind: 'tool' as const, toolName: 'respond_card', payload: { card: 'guard' } }],
        ],
      ]),
    )
    const orchestrator = new MatchOrchestrator({ module, machine, driver })
    await orchestrator.runDecision()
    expect(machine.currentDecision()?.actors[0]?.participantId).toBe('participant-one')
    await orchestrator.runDecision()
    expect(machine.currentDecision()?.actors[0]?.participantId).toBe('participant-two')
    await orchestrator.runDecision()
    expect(machine.state.stage).toBe('main')
    orchestrator.close()
  })

  it('allows a game adapter to wrap default boundary execution', async () => {
    const module = createHiddenTeamModule()
    const machine = module.create({
      matchId: MatchIdSchema.parse('match-hidden-team'),
      setup: hiddenTeamSetup(),
      seed: 1,
    })
    const driver = new ScriptedParticipantDriver(
      new Map([
        [
          ParticipantIdSchema.parse('participant-red-one'),
          [{ kind: 'text' as const, text: 'warm' }],
        ],
        [
          ParticipantIdSchema.parse('participant-blue-one'),
          [{ kind: 'text' as const, text: 'water' }],
        ],
      ]),
    )
    const calls: string[] = []
    const orchestrator = new MatchOrchestrator({
      module,
      machine,
      driver,
      boundaryExecutor: {
        execute: async (context) => {
          calls.push(`before:${context.boundary.id}`)
          const result = await context.runDefault()
          calls.push(`after:${result.events.length}`)
          return result
        },
      },
      beforeSubmit: (boundary, actions) => {
        calls.push(`submit:${boundary.id}:${actions.length}`)
      },
    })
    await orchestrator.runDecision()
    expect(calls).toEqual(['before:decision-clue-1', 'submit:decision-clue-1:2', 'after:2'])
  })

  it('runs to an outcome, publishes events, and returns null after the terminal boundary', async () => {
    const module = createHiddenTeamModule()
    const machine = module.create({
      matchId: MatchIdSchema.parse('match-hidden-team'),
      setup: { ...hiddenTeamSetup(), rounds: 1 },
      seed: 1,
    })
    const driver = new ScriptedParticipantDriver(
      new Map([
        [
          ParticipantIdSchema.parse('participant-red-one'),
          [{ kind: 'text' as const, text: 'warm' }],
        ],
        [
          ParticipantIdSchema.parse('participant-blue-one'),
          [{ kind: 'text' as const, text: 'water' }],
        ],
        [
          ParticipantIdSchema.parse('participant-red-two'),
          [
            {
              kind: 'tool' as const,
              toolName: 'submit_guess',
              payload: { targetGroupId: 'group-blue', value: 'ocean' },
            },
          ],
        ],
        [
          ParticipantIdSchema.parse('participant-blue-two'),
          [
            {
              kind: 'tool' as const,
              toolName: 'submit_guess',
              payload: { targetGroupId: 'group-red', value: 'wrong' },
            },
          ],
        ],
      ]),
    )
    const published: number[] = []
    const gateway = new ActionGateway()
    const orchestrator = new MatchOrchestrator({
      module,
      machine,
      driver,
      gateway,
      onEvents: (events) => {
        published.push(events.length)
      },
    })
    await expect(orchestrator.runUntilOutcome(2)).resolves.toMatchObject({
      winningGroupIds: ['group-red'],
    })
    expect(published).toHaveLength(2)
    await expect(orchestrator.runDecision()).resolves.toBeNull()
    orchestrator.close()
  })

  it('rejects observation drift and bounded runs without outcomes', async () => {
    const module = createHiddenTeamModule()
    const machine = module.create({
      matchId: MatchIdSchema.parse('match-hidden-team'),
      setup: hiddenTeamSetup(),
      seed: 1,
    })
    const drifted = {
      ...module,
      observe: (...args: Parameters<typeof module.observe>) => ({
        ...module.observe(...args),
        revision: 99,
      }),
    }
    const driver = new ScriptedParticipantDriver(new Map())
    await expect(
      new MatchOrchestrator({ module: drifted, machine, driver }).runDecision(),
    ).rejects.toThrow(/Observation 99/)
    await expect(
      new MatchOrchestrator({ module, machine, driver }).runUntilOutcome(0),
    ).rejects.toThrow(/did not reach an outcome/)

    let failure: unknown
    const silentDriver = { takeTurn: async () => undefined }
    await expect(
      new MatchOrchestrator({
        module,
        machine,
        driver: silentDriver,
        onFailure: (error) => {
          failure = error
        },
      }).runDecision(),
    ).rejects.toThrow(/missing actors/)
    expect(failure).toBeInstanceOf(Error)

    await expect(
      new MatchOrchestrator({
        module,
        machine,
        driver: { takeTurn: async () => Promise.reject('non-error failure') },
      }).runDecision(),
    ).rejects.toThrow(/non-error failure/)
  })
})

describe('Action gateway', () => {
  it('validates tokens, tools, text actions, duplicates, and incomplete seals', () => {
    const module = createHiddenTeamModule()
    const machine = module.create({
      matchId: MatchIdSchema.parse('match-hidden-team'),
      setup: hiddenTeamSetup(),
      seed: 1,
    })
    const boundary = machine.currentDecision()!
    const gateway = new ActionGateway()
    gateway.open(machine.matchId, boundary)
    const red = gateway.issueToken(machine.matchId, boundary.actors[0]!.participantId)
    expect(() => gateway.submitTool('bad-token', 'submit_clue', { text: 'x' })).toThrow(/invalid/)
    expect(() => gateway.submitTool(red, 'unknown', {})).toThrow(/unavailable/)
    expect(() => gateway.submitTool(red, 'submit_clue', { text: 'x' })).toThrow(/direct text/)
    expect(() => gateway.submitText(red, 'text')).not.toThrow()
    expect(() => gateway.submitText(red, 'again')).toThrow(/already submitted/)
    expect(gateway.seal(machine.matchId, boundary)).toBeNull()
    expect(gateway.pendingActors(machine.matchId, boundary)).toEqual([
      boundary.actors[1]!.participantId,
    ])
    gateway.revokeToken(red)
    gateway.revokeToken('unknown-token')
    gateway.close(machine.matchId, boundary)

    const waiting = new ActionGateway()
    const waitingToken = waiting.issueToken(machine.matchId, boundary.actors[0]!.participantId)
    expect(() => waiting.submitText(waitingToken, 'text')).toThrow(/not waiting/)

    const reaction = createReactionCardModule().create({
      matchId: MatchIdSchema.parse('match-reaction-card'),
      setup: reactionCardSetup(['focus', 'guard', 'strike', 'guard']),
      seed: 1,
    })
    const reactionBoundary = reaction.currentDecision()!
    waiting.open(reaction.matchId, reactionBoundary)
    const reactionToken = waiting.issueToken(
      reaction.matchId,
      reactionBoundary.actors[0]!.participantId,
    )
    expect(() => waiting.submitText(reactionToken, 'text')).toThrow(/exactly one text action/)

    const plainTextBoundary = {
      id: DecisionIdSchema.parse('decision-plain-text'),
      kind: SemanticIdSchema.parse('decision.plain-text'),
      mode: 'single' as const,
      observationRevision: 0,
      actors: [
        {
          participantId: ParticipantIdSchema.parse('participant-plain'),
          actions: [
            {
              actionType: SemanticIdSchema.parse('action.plain-text'),
              toolName: 'plain_text',
              inputMode: 'text' as const,
              schema: z.string(),
            },
          ],
        },
      ],
    }
    const plain = new ActionGateway()
    plain.open(machine.matchId, plainTextBoundary)
    const plainToken = plain.issueToken(machine.matchId, plainTextBoundary.actors[0]!.participantId)
    expect(plain.submitText(plainToken, 'hello').accepted).toBe(true)
    const sealed = plain.seal(machine.matchId, plainTextBoundary)
    expect(sealed?.[0]?.payload).toBe('hello')
    expect(() =>
      plain.restore(MatchIdSchema.parse('match-other'), plainTextBoundary, sealed![0]!),
    ).toThrow(/another Match/)
    const unopened = new ActionGateway()
    expect(() => unopened.restore(machine.matchId, plainTextBoundary, sealed![0]!)).toThrow(
      /No action expectation/,
    )
  })
})

function bindings(matchId: ReturnType<typeof MatchIdSchema.parse>, ids: readonly string[]) {
  const sessions = new MemorySessionBindingStore()
  for (const id of ids) {
    const participantId = ParticipantIdSchema.parse(id)
    sessions.put({
      matchId,
      participantId,
      state: 'active',
      sessionId: `session-${id}`,
      sessionGeneration: 1,
      bootstrapState: 'acknowledged',
      pendingAction: null,
    })
  }
  return sessions
}

function stableClock(): () => Date {
  let tick = 0
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++))
}
