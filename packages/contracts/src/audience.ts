import { z } from 'zod'
import { GroupIdSchema, ParticipantIdSchema } from './ids.js'

export const AudienceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('public') }).strict(),
  z.object({ kind: z.literal('host') }).strict(),
  z
    .object({
      kind: z.literal('participants'),
      participantIds: z.array(ParticipantIdSchema).min(1),
    })
    .strict()
    .superRefine((value, context) => {
      if (new Set(value.participantIds).size !== value.participantIds.length) {
        context.addIssue({ code: 'custom', message: 'Audience participants must be unique' })
      }
    }),
  z.object({ kind: z.literal('group'), groupId: GroupIdSchema }).strict(),
])
export type Audience = z.infer<typeof AudienceSchema>

export const ObserverSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('host') }).strict(),
  z.object({ kind: z.literal('spectator') }).strict(),
  z.object({ kind: z.literal('participant'), participantId: ParticipantIdSchema }).strict(),
])
export type Observer = z.infer<typeof ObserverSchema>

export type GroupMembership = ReadonlyMap<string, ReadonlySet<string>>

export function canObserve(
  audience: Audience,
  observer: Observer,
  groups: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): boolean {
  if (observer.kind === 'host') return true
  switch (audience.kind) {
    case 'public':
      return true
    case 'host':
      return false
    case 'participants':
      return (
        observer.kind === 'participant' && audience.participantIds.includes(observer.participantId)
      )
    case 'group':
      return (
        observer.kind === 'participant' &&
        (groups.get(audience.groupId)?.has(observer.participantId) ?? false)
      )
    default: {
      const exhaustive: never = audience
      return exhaustive
    }
  }
}
