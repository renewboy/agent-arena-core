import { z } from 'zod'
import { AudienceSchema } from './audience.js'
import {
  DecisionIdSchema,
  EventSequenceSchema,
  MatchIdSchema,
  ObservationRevisionSchema,
  ParticipantIdSchema,
  SemanticIdSchema,
} from './ids.js'
import { JsonValueSchema } from './json.js'

export const GameActionSchema = z
  .object({
    matchId: MatchIdSchema,
    decisionId: DecisionIdSchema,
    actorId: ParticipantIdSchema,
    actionType: SemanticIdSchema,
    payload: JsonValueSchema,
  })
  .strict()
export type GameAction = z.infer<typeof GameActionSchema>

export const GameEventDraftSchema = z
  .object({
    eventType: SemanticIdSchema,
    schemaVersion: z.number().int().positive(),
    audience: AudienceSchema,
    payload: JsonValueSchema,
  })
  .strict()
export type GameEventDraft = z.infer<typeof GameEventDraftSchema>

export const GameEventSchema = GameEventDraftSchema.extend({
  matchId: MatchIdSchema,
  sequence: EventSequenceSchema,
  occurredAt: z.string().datetime(),
}).strict()
export type GameEvent = z.infer<typeof GameEventSchema>

export const DecisionModeSchema = z.enum(['single', 'barrier'])
export type DecisionMode = z.infer<typeof DecisionModeSchema>

const DecisionActorSchema = z
  .object({
    participantId: ParticipantIdSchema,
    actionTypes: z.array(SemanticIdSchema).min(1),
  })
  .strict()

export const DecisionBoundaryDescriptorSchema = z
  .object({
    id: DecisionIdSchema,
    kind: SemanticIdSchema,
    mode: DecisionModeSchema,
    observationRevision: ObservationRevisionSchema,
    actors: z.array(DecisionActorSchema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.actors.map((actor) => actor.participantId)
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'Decision actors must be unique' })
    }
    if (value.mode === 'single' && value.actors.length !== 1) {
      context.addIssue({ code: 'custom', message: 'A single decision requires exactly one actor' })
    }
    for (const actor of value.actors) {
      if (new Set(actor.actionTypes).size !== actor.actionTypes.length) {
        context.addIssue({ code: 'custom', message: 'Actor action types must be unique' })
      }
    }
  })
export type DecisionBoundaryDescriptor = z.infer<typeof DecisionBoundaryDescriptorSchema>
