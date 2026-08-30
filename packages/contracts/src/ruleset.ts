import { z } from 'zod'
import { JsonValueSchema } from './json.js'
import { PluginIdSchema, RulesetIdSchema } from './ids.js'

export const PluginLockSchema = z
  .object({
    id: PluginIdSchema,
    version: z.number().int().positive(),
    config: JsonValueSchema.default({}),
    configHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
export type PluginLock = z.infer<typeof PluginLockSchema>

export const RulesetLockSchema = z
  .object({
    id: RulesetIdSchema,
    revision: z.number().int().positive(),
    plugins: z.array(PluginLockSchema),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
export type RulesetLock = z.infer<typeof RulesetLockSchema>
