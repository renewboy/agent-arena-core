import {
  DecisionBoundaryDescriptorSchema,
  GameActionSchema,
  type Audience,
  type DecisionBoundaryDescriptor,
  type DecisionId,
  type DecisionMode,
  type GameAction,
  type JsonValue,
  type ObservationRevision,
  type ParticipantId,
  type SemanticId,
} from '@agent-arena/contracts'
import type { z } from 'zod'
import { RuleViolation, assertRule } from './errors.js'

export type ActionInputMode = 'structured' | 'text' | 'either'

export interface ActionSpec<Payload extends JsonValue = JsonValue> {
  readonly actionType: SemanticId
  readonly toolName: string
  readonly inputMode: ActionInputMode
  readonly schema: z.ZodType<Payload>
  readonly streamAudience?: Audience
}

export interface DecisionActor {
  readonly participantId: ParticipantId
  readonly actions: readonly ActionSpec[]
}

export interface DecisionBoundary {
  readonly id: DecisionId
  readonly kind: SemanticId
  readonly mode: DecisionMode
  readonly observationRevision: ObservationRevision
  readonly actors: readonly DecisionActor[]
}

export function decisionDescriptor(boundary: DecisionBoundary): DecisionBoundaryDescriptor {
  return DecisionBoundaryDescriptorSchema.parse({
    id: boundary.id,
    kind: boundary.kind,
    mode: boundary.mode,
    observationRevision: boundary.observationRevision,
    actors: boundary.actors.map((actor) => ({
      participantId: actor.participantId,
      actionTypes: actor.actions.map((action) => action.actionType),
    })),
  })
}

export function validateDecisionAction(boundary: DecisionBoundary, input: GameAction): GameAction {
  const action = GameActionSchema.parse(input)
  assertRule(action.decisionId === boundary.id, `Decision ${action.decisionId} is not active`)
  const actor = boundary.actors.find((candidate) => candidate.participantId === action.actorId)
  assertRule(actor, `Participant ${action.actorId} is not an actor in ${boundary.id}`)
  const spec = actor.actions.find((candidate) => candidate.actionType === action.actionType)
  assertRule(spec, `Action ${action.actionType} is unavailable for ${action.actorId}`)
  try {
    return { ...action, payload: spec.schema.parse(action.payload) }
  } catch (error) {
    throw new RuleViolation(`Action ${action.actionType} payload is invalid`, { cause: error })
  }
}

export function validateDecisionBatch(
  boundary: DecisionBoundary,
  inputs: readonly GameAction[],
): GameAction[] {
  decisionDescriptor(boundary)
  const actions = inputs.map((input) => validateDecisionAction(boundary, input))
  const byActor = new Map<ParticipantId, GameAction>()
  for (const action of actions) {
    if (byActor.has(action.actorId)) {
      throw new RuleViolation(`Participant ${action.actorId} submitted more than one action`)
    }
    byActor.set(action.actorId, action)
  }
  if (boundary.mode === 'single') {
    assertRule(actions.length === 1, `Decision ${boundary.id} requires one action`)
  } else {
    assertRule(
      byActor.size === boundary.actors.length,
      `Decision ${boundary.id} requires every barrier actor`,
    )
  }
  return boundary.actors.map((actor) => byActor.get(actor.participantId)!).filter(Boolean)
}
