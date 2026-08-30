import { z } from 'zod'
import {
  DecisionIdSchema,
  GameActionSchema,
  GameEventSchema,
  GameIdSchema,
  JsonValueSchema,
  MatchIdSchema,
  ObservationRevisionSchema,
  ParticipantIdSchema,
  RulesetLockSchema,
  SemanticIdSchema,
  SimulationIdSchema,
} from '@agent-arena/contracts'

export const SimulationFaultSchema = z.enum([
  'uncertain-delivery',
  'timeout',
  'process-exit',
  'invalid-action',
  'cancelled',
  'other',
])
export type SimulationFault = z.infer<typeof SimulationFaultSchema>

export const SimulationVariantSchema = SemanticIdSchema
export type SimulationVariant = z.infer<typeof SimulationVariantSchema>

export const SimulationTurnSchema = z
  .object({
    ordinal: z.number().int().positive(),
    kind: z.enum(['bootstrap', 'action']),
    participantId: ParticipantIdSchema,
    decisionId: DecisionIdSchema.nullable(),
    decisionKind: SemanticIdSchema.nullable(),
    mode: z.enum(['single', 'barrier']).nullable(),
    expectedActors: z.array(ParticipantIdSchema),
    fromRevision: ObservationRevisionSchema,
    toRevision: ObservationRevisionSchema,
    visibleEventSequences: z.array(z.number().int().positive()),
    sessionGeneration: z.number().int().positive(),
    attempt: z.number().int().positive(),
    completionOrder: z.number().int().positive(),
    status: z.enum(['completed', 'failed', 'uncertain', 'cancelled']),
    fault: SimulationFaultSchema.nullable(),
    action: GameActionSchema.nullable(),
  })
  .strict()
export type SimulationTurn = z.infer<typeof SimulationTurnSchema>

export const SimulationControlSchema = z
  .object({
    type: SemanticIdSchema,
    order: z.number().int().positive(),
    payload: JsonValueSchema,
  })
  .strict()
export type SimulationControl = z.infer<typeof SimulationControlSchema>

export const SimulationExpectedSchema = z
  .object({
    events: z.array(GameEventSchema),
    checkpoint: JsonValueSchema,
  })
  .strict()
export type SimulationExpected = z.infer<typeof SimulationExpectedSchema>

export const SimulationReviewedExpectedSchema = z
  .object({
    eventCount: z.number().int().nonnegative(),
    eventDigest: z.string().regex(/^[a-f0-9]{64}$/),
    eventTypes: z.array(SemanticIdSchema),
    checkpoint: JsonValueSchema,
  })
  .strict()
export type SimulationReviewedExpected = z.infer<typeof SimulationReviewedExpectedSchema>

const SimulationCommonSchema = z
  .object({
    schemaVersion: z.literal(1),
    simulationId: SimulationIdSchema,
    title: z.string().min(1).max(120),
    gameId: GameIdSchema,
    ruleset: RulesetLockSchema,
    matchId: MatchIdSchema,
    setup: JsonValueSchema,
    turns: z.array(SimulationTurnSchema),
    controls: z.array(SimulationControlSchema).default([]),
  })
  .strict()

export const SimulationCaptureSchema = SimulationCommonSchema.extend({
  stage: z.literal('candidate'),
  source: z
    .object({
      status: z.enum(['paused', 'ended']),
      cutoffSequence: z.number().int().nonnegative(),
      capturedAt: z.string().datetime(),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  observed: SimulationExpectedSchema,
  warnings: z.array(z.string().max(2_000)),
}).strict()
export type SimulationCapture = z.infer<typeof SimulationCaptureSchema>

export const SimulationFixtureSchema = SimulationCommonSchema.extend({
  stage: z.literal('approved'),
  source: z
    .object({
      status: z.enum(['paused', 'ended']),
      cutoffSequence: z.number().int().nonnegative(),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  expected: SimulationReviewedExpectedSchema,
  variants: z.array(SimulationVariantSchema).min(1),
}).strict()
export type SimulationFixture = z.infer<typeof SimulationFixtureSchema>

export const SimulationCandidateResultSchema = z
  .object({
    simulationId: SimulationIdSchema,
    relativePath: z.string().min(1),
    created: z.boolean(),
    warnings: z.array(z.string()),
  })
  .strict()
export type SimulationCandidateResult = z.infer<typeof SimulationCandidateResultSchema>

const SimulationRunnerReviewSchema = z
  .object({
    runnerId: SemanticIdSchema,
    deterministic: z.boolean(),
    ok: z.boolean(),
    failures: z.array(z.string()),
  })
  .strict()

export const SimulationReviewResultSchema = z
  .object({
    simulationId: SimulationIdSchema,
    relativePath: z.string().min(1),
    sourceStatus: z.enum(['paused', 'ended']),
    turns: z.number().int().nonnegative(),
    events: z.number().int().nonnegative(),
    runners: z.array(SimulationRunnerReviewSchema).min(2),
    runnersAgree: z.boolean(),
    canApprove: z.boolean(),
    canAcceptCurrent: z.boolean(),
    failures: z.array(z.string()),
    warnings: z.array(z.string()),
    secretWarnings: z.array(z.string()),
  })
  .strict()
export type SimulationReviewResult = z.infer<typeof SimulationReviewResultSchema>

export const SimulationApprovalRequestSchema = z
  .object({
    acceptCurrent: z.boolean().default(false),
    acknowledgeWarnings: z.boolean().default(false),
  })
  .strict()
export type SimulationApprovalRequest = z.infer<typeof SimulationApprovalRequestSchema>

export const SimulationApprovalResultSchema = z
  .object({
    simulationId: SimulationIdSchema,
    relativePath: z.string().min(1),
    created: z.boolean(),
    variants: z.array(SimulationVariantSchema).min(1),
  })
  .strict()
export type SimulationApprovalResult = z.infer<typeof SimulationApprovalResultSchema>

export const SimulationRunReportSchema = z
  .object({
    simulationId: SimulationIdSchema,
    runnerId: SemanticIdSchema,
    variant: SimulationVariantSchema,
    seed: z.string().regex(/^[a-f0-9]{16}$/),
    ok: z.boolean(),
    failures: z.array(z.string()),
    actual: SimulationExpectedSchema,
  })
  .strict()
export type SimulationRunReport = z.infer<typeof SimulationRunReportSchema>
