import { z } from 'zod'

export type Brand<Value, Name extends string> = Value & { readonly __brand: Name }

const idText = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)

export type GameId = Brand<string, 'GameId'>
export const GameIdSchema = idText.transform((value) => value as GameId)

export type MatchId = Brand<string, 'MatchId'>
export const MatchIdSchema = idText.transform((value) => value as MatchId)

export type ParticipantId = Brand<string, 'ParticipantId'>
export const ParticipantIdSchema = idText.transform((value) => value as ParticipantId)

export type GroupId = Brand<string, 'GroupId'>
export const GroupIdSchema = idText.transform((value) => value as GroupId)

export type DecisionId = Brand<string, 'DecisionId'>
export const DecisionIdSchema = idText.transform((value) => value as DecisionId)

export type PluginId = Brand<string, 'PluginId'>
export const PluginIdSchema = idText.transform((value) => value as PluginId)

export type RulesetId = Brand<string, 'RulesetId'>
export const RulesetIdSchema = idText.transform((value) => value as RulesetId)

export type SemanticId = Brand<string, 'SemanticId'>
export const SemanticIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)
  .transform((value) => value as SemanticId)

export const EventSequenceSchema = z.number().int().positive()
export type EventSequence = z.infer<typeof EventSequenceSchema>

export const ObservationRevisionSchema = z.number().int().nonnegative()
export type ObservationRevision = z.infer<typeof ObservationRevisionSchema>
