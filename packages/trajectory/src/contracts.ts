import { z } from 'zod'
import { MatchIdSchema } from '@agent-arena/contracts'

export const TrajectoryTurnStatusSchema = z.enum([
  'running',
  'completed',
  'failed',
  'uncertain',
  'cancelled',
])
export type TrajectoryTurnStatus = z.infer<typeof TrajectoryTurnStatusSchema>

export const TrajectoryUsageSchema = z
  .object({
    used: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    cost: z
      .object({ amount: z.number(), currency: z.string().min(1) })
      .nullable()
      .default(null),
  })
  .strict()
export type TrajectoryUsage = z.infer<typeof TrajectoryUsageSchema>

export const TrajectoryTurnSchema = z
  .object({
    matchId: MatchIdSchema,
    turnId: z.string().min(1).max(160),
    ownerId: z.string().min(1).max(160),
    sessionId: z.string().min(1).max(320),
    sessionGeneration: z.number().int().positive(),
    ordinal: z.number().int().positive(),
    attempt: z.number().int().positive(),
    kind: z.enum(['bootstrap', 'action', 'auxiliary']),
    decisionId: z.string().max(160).nullable(),
    actionType: z.string().min(1).max(120),
    fromRevision: z.number().int().nonnegative(),
    toRevision: z.number().int().nonnegative(),
    visibleEventSequences: z.array(z.number().int().positive()).default([]),
    runtimeStatus: z.string().max(80).nullable().default(null),
    continuation: z.boolean().default(false),
    status: TrajectoryTurnStatusSchema,
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    stopReason: z.string().max(120).nullable(),
    error: z.string().max(16_384).nullable(),
    usage: TrajectoryUsageSchema.nullable(),
    revision: z.number().int().nonnegative(),
  })
  .strict()
export type TrajectoryTurn = z.infer<typeof TrajectoryTurnSchema>

export const TrajectoryRecordKindSchema = z.enum([
  'instructions',
  'prompt',
  'reasoning',
  'message',
  'tool',
  'permission',
  'action',
  'usage',
  'diagnostic',
  'lifecycle',
  'error',
])
export type TrajectoryRecordKind = z.infer<typeof TrajectoryRecordKindSchema>

export const TrajectoryRecordSchema = z
  .object({
    matchId: MatchIdSchema,
    recordId: z.string().min(1).max(240),
    turnId: z.string().min(1).max(160),
    ownerId: z.string().min(1).max(160),
    ordinal: z.number().int().positive(),
    step: z.number().int().positive(),
    kind: TrajectoryRecordKindSchema,
    title: z.string().min(1).max(160),
    status: z.string().max(120).nullable(),
    text: z.string().max(131_072).nullable(),
    input: z.string().max(131_072).nullable(),
    output: z.string().max(131_072).nullable(),
    usage: TrajectoryUsageSchema.nullable(),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    truncatedFields: z.array(z.enum(['text', 'input', 'output'])),
    revision: z.number().int().nonnegative(),
  })
  .strict()
export type TrajectoryRecord = z.infer<typeof TrajectoryRecordSchema>

export interface TrajectoryTurnBase {
  readonly matchId: string
  readonly turnId: string
  readonly ownerId: string
  readonly status: TrajectoryTurnStatus
  readonly startedAt: string
  readonly completedAt: string | null
  readonly durationMs: number | null
  readonly stopReason: string | null
  readonly error: string | null
  readonly usage: TrajectoryUsage | null
}

export interface TrajectoryRecordBase {
  readonly matchId: string
  readonly recordId: string
  readonly turnId: string
  readonly ownerId: string
  readonly kind: TrajectoryRecordKind
  readonly title: string
  readonly status: string | null
  readonly text: string | null
  readonly input: string | null
  readonly output: string | null
  readonly startedAt: string
  readonly truncatedFields: readonly ('text' | 'input' | 'output')[]
}
