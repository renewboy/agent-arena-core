import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  GameEventSchema,
  MatchIdSchema,
  ParticipantIdSchema,
  type GameEvent,
  type JsonValue,
  type MatchId,
} from '@agent-arena/contracts'
import { MatchOrchestrator } from '@agent-arena/match-runtime'
import {
  AdaptedSimulationWorkflow,
  type AdaptedSimulationRunner,
  type SimulationArtifactAdapter,
} from '@agent-arena/simulation'
import { MemorySessionBindingStore, ScriptedParticipantDriver } from '@agent-arena/testkit'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createHiddenTeamModule, hiddenTeamAction, hiddenTeamSetup } from '../src/index.js'
import {
  createReactionCardModule,
  reactionCardAction,
  reactionCardSetup,
} from '../../reaction-card/src/index.js'

const VariantSchema = z.enum(['recorded', 'reverse', 'transient', 'restart'])
type Variant = z.infer<typeof VariantSchema>
const ExpectedSchema = z.object({ events: z.array(GameEventSchema), checkpoint: z.json() }).strict()
type Expected = z.infer<typeof ExpectedSchema>
const CaptureSchema = z
  .object({
    stage: z.literal('candidate'),
    simulationId: z.string(),
    game: z.enum(['hidden-team', 'reaction-card']),
    fingerprint: z.string(),
    observed: ExpectedSchema,
  })
  .strict()
const FixtureSchema = z
  .object({
    stage: z.literal('approved'),
    simulationId: z.string(),
    game: z.enum(['hidden-team', 'reaction-card']),
    fingerprint: z.string(),
    expected: ExpectedSchema,
    variants: z.array(VariantSchema),
  })
  .strict()
type Capture = z.infer<typeof CaptureSchema>
type Fixture = z.infer<typeof FixtureSchema>

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('cross-game full-stack conformance', () => {
  for (const game of ['hidden-team', 'reaction-card'] as const) {
    it(`${game} passes candidate review, approval, dual runners, ordering, transient failure, and restart`, async () => {
      const root = await temporaryRoot()
      const simulationId = `simulation-${game}-conformance`
      const observed = await runEngine(game, 'recorded')
      const capture = CaptureSchema.parse({
        stage: 'candidate',
        simulationId,
        game,
        fingerprint: `${game}-fingerprint`,
        observed,
      })
      const runners = [engineRunner(), orchestrationRunner()]
      const workflow = new AdaptedSimulationWorkflow({
        projectRoot: root,
        candidateDirectory: resolve(root, 'candidates'),
        fixtureDirectory: resolve(root, 'fixtures'),
        reviewVariant: 'recorded' as const,
        adapter,
        runners,
      })
      await workflow.addCandidate(capture)
      await expect(workflow.reviewCandidate(simulationId)).resolves.toMatchObject({
        canApprove: true,
        runnersAgree: true,
      })
      const approved = await workflow.approveCandidate(simulationId, {
        acceptCurrent: false,
        acknowledgeWarnings: false,
      })
      expect(approved.variants).toEqual(['recorded', 'reverse', 'transient', 'restart'])
      const fixture = adapter.buildFixture(capture, observed, approved.variants)
      for (const variant of approved.variants) {
        const reports = await Promise.all(runners.map((runner) => runner.run(fixture, variant)))
        const engine = reports[0]!
        const orchestration = reports[1]!
        expect(engine.actual, `${game}/${variant}`).toEqual(orchestration.actual)
        expect(engine.failures, `${game}/${variant}`).toEqual([])
        expect(orchestration.failures, `${game}/${variant}`).toEqual([])
      }
    })
  }
})

const adapter: SimulationArtifactAdapter<Capture, Fixture, Expected, Expected, Variant> = {
  parseCapture: (input) => CaptureSchema.parse(input),
  parseFixture: (input) => FixtureSchema.parse(input),
  describeCapture: (capture) => ({
    simulationId: capture.simulationId,
    sourceStatus: 'ended',
    sourceFingerprint: capture.fingerprint,
    warnings: [],
    turnCount: capture.game === 'hidden-team' ? 4 : 3,
    eventCount: capture.observed.events.length,
    observed: capture.observed,
  }),
  reviewedExpected: (actual) => ExpectedSchema.parse(actual),
  variants: () => ['recorded', 'reverse', 'transient', 'restart'],
  buildFixture: (capture, actual, variants) =>
    FixtureSchema.parse({
      stage: 'approved',
      simulationId: capture.simulationId,
      game: capture.game,
      fingerprint: capture.fingerprint,
      expected: actual,
      variants,
    }),
  describeFixture: (fixture) => ({
    sourceFingerprint: fixture.fingerprint,
    expected: fixture.expected,
    variants: fixture.variants,
  }),
  sameExpected: (left, right) => JSON.stringify(left) === JSON.stringify(right),
}

function engineRunner(): AdaptedSimulationRunner<Capture | Fixture, Expected, Variant> {
  return {
    id: 'engine',
    run: async (input, variant) =>
      report(input, variant, 'engine', await runEngine(input.game, variant)),
  }
}

function orchestrationRunner(): AdaptedSimulationRunner<Capture | Fixture, Expected, Variant> {
  return {
    id: 'orchestration',
    run: async (input, variant) =>
      report(input, variant, 'orchestration', await runOrchestration(input.game, variant)),
  }
}

function report(input: Capture | Fixture, variant: Variant, runnerId: string, actual: Expected) {
  return {
    simulationId: input.simulationId,
    runnerId,
    variant,
    ok: true,
    failures: [],
    actual,
  }
}

async function runEngine(game: Capture['game'], variant: Variant): Promise<Expected> {
  return game === 'hidden-team' ? runHiddenEngine(variant) : runReactionEngine(variant)
}

async function runOrchestration(game: Capture['game'], variant: Variant): Promise<Expected> {
  return game === 'hidden-team'
    ? runHiddenOrchestration(variant)
    : runReactionOrchestration(variant)
}

function runHiddenEngine(variant: Variant): Expected {
  const module = createHiddenTeamModule()
  const setup = { ...hiddenTeamSetup(), rounds: 1 }
  const matchId = MatchIdSchema.parse('match-hidden-team')
  let machine = module.create({ matchId, setup, seed: 1, clock: stableClock() })
  const clue = machine.currentDecision()!
  machine.submit([
    hiddenTeamAction({
      decisionId: clue.id,
      actorId: 'participant-red-one',
      actionType: 'clue.submit',
      payload: { text: 'warm' },
    }),
    hiddenTeamAction({
      decisionId: clue.id,
      actorId: 'participant-blue-one',
      actionType: 'clue.submit',
      payload: { text: 'water' },
    }),
  ])
  if (variant === 'restart') {
    machine = module.restore({ matchId, setup, events: machine.events, clock: stableClock() })
  }
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
  return expected(machine.events, machine.state)
}

function runReactionEngine(variant: Variant): Expected {
  const module = createReactionCardModule()
  const setup = {
    ...reactionCardSetup(['focus', 'guard', 'strike', 'focus']),
    startingHealth: 1,
  }
  const matchId = MatchIdSchema.parse('match-reaction-card')
  let machine = module.create({ matchId, setup, seed: 1, clock: stableClock() })
  const focus = machine.currentDecision()!
  machine.submit([
    reactionCardAction({
      decisionId: focus.id,
      actorId: 'participant-one',
      actionType: 'card.play',
      payload: { card: 'focus' },
    }),
  ])
  if (variant === 'restart') {
    machine = module.restore({ matchId, setup, events: machine.events, clock: stableClock() })
  }
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
  return expected(machine.events, machine.state)
}

async function runHiddenOrchestration(variant: Variant): Promise<Expected> {
  const module = createHiddenTeamModule()
  const setup = { ...hiddenTeamSetup(), rounds: 1 }
  const matchId = MatchIdSchema.parse('match-hidden-team')
  let machine = module.create({ matchId, setup, seed: 1, clock: stableClock() })
  const sessions = sessionBindings(matchId, [
    'participant-red-one',
    'participant-blue-one',
    'participant-red-two',
    'participant-blue-two',
  ])
  const reverse = variant === 'reverse'
  const transient = variant === 'transient'
  const driver = new ScriptedParticipantDriver(
    new Map([
      [
        ParticipantIdSchema.parse('participant-red-one'),
        [{ kind: 'text' as const, text: 'warm', delayMs: reverse ? 10 : 0 }],
      ],
      [
        ParticipantIdSchema.parse('participant-blue-one'),
        [
          ...(transient ? [{ kind: 'failure' as const, message: 'transient delivery' }] : []),
          { kind: 'text' as const, text: 'water', delayMs: reverse ? 0 : 10 },
        ],
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
  let orchestrator = new MatchOrchestrator({ module, machine, driver, sessions })
  if (transient) await expect(orchestrator.runDecision()).rejects.toThrow(/transient delivery/)
  await orchestrator.runDecision()
  if (variant === 'restart') {
    machine = module.restore({ matchId, setup, events: machine.events, clock: stableClock() })
    orchestrator = new MatchOrchestrator({ module, machine, driver, sessions })
  }
  await orchestrator.runDecision()
  return expected(machine.events, machine.state)
}

async function runReactionOrchestration(variant: Variant): Promise<Expected> {
  const module = createReactionCardModule()
  const setup = {
    ...reactionCardSetup(['focus', 'guard', 'strike', 'focus']),
    startingHealth: 1,
  }
  const matchId = MatchIdSchema.parse('match-reaction-card')
  let machine = module.create({ matchId, setup, seed: 1, clock: stableClock() })
  const transient = variant === 'transient'
  const driver = new ScriptedParticipantDriver(
    new Map([
      [
        ParticipantIdSchema.parse('participant-one'),
        [
          ...(transient ? [{ kind: 'failure' as const, message: 'transient delivery' }] : []),
          { kind: 'tool' as const, toolName: 'play_card', payload: { card: 'focus' } },
          { kind: 'tool' as const, toolName: 'play_card', payload: { card: 'strike' } },
        ],
      ],
      [
        ParticipantIdSchema.parse('participant-two'),
        [{ kind: 'tool' as const, toolName: 'pass_response', payload: {} }],
      ],
    ]),
  )
  let orchestrator = new MatchOrchestrator({ module, machine, driver })
  if (transient) await expect(orchestrator.runDecision()).rejects.toThrow(/transient delivery/)
  await orchestrator.runDecision()
  if (variant === 'restart') {
    machine = module.restore({ matchId, setup, events: machine.events, clock: stableClock() })
    orchestrator = new MatchOrchestrator({ module, machine, driver })
  }
  await orchestrator.runDecision()
  await orchestrator.runDecision()
  return expected(machine.events, machine.state)
}

function sessionBindings(matchId: MatchId, participantIds: readonly string[]) {
  const store = new MemorySessionBindingStore()
  for (const value of participantIds) {
    const participantId = ParticipantIdSchema.parse(value)
    store.put({
      matchId,
      participantId,
      state: 'active',
      sessionId: `session-${participantId}`,
      sessionGeneration: 1,
      bootstrapState: 'acknowledged',
      pendingAction: null,
    })
  }
  return store
}

function expected(events: readonly GameEvent[], state: unknown): Expected {
  return ExpectedSchema.parse({
    events,
    checkpoint: JSON.parse(JSON.stringify(state)) as JsonValue,
  })
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'arena-full-stack-'))
  roots.push(root)
  return root
}

function stableClock(): () => Date {
  let tick = 0
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++))
}
