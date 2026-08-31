import { MatchIdSchema } from '@agent-arena/contracts'
import {
  LiveProjectionController,
  SequencedCueQueue,
  type LiveChannelHandlers,
} from '@agent-arena/web-runtime'
import { describe, expect, it } from 'vitest'
import { createReactionCardModule, reactionCardSetup } from '../src/index.js'

describe('Reaction Card web runtime conformance', () => {
  it('keeps participant-only hands in the game projection adapter', () => {
    const module = createReactionCardModule()
    const setup = reactionCardSetup(['strike', 'guard', 'focus', 'strike'])
    const machine = module.create({
      matchId: MatchIdSchema.parse('match-reaction-web'),
      setup,
      seed: 1,
    })
    const spectator = module.observe(machine, { kind: 'spectator' })
    const participant = module.observe(machine, {
      kind: 'participant',
      participantId: setup.participants[0]!,
    })
    expect(spectator.facts.hand).toEqual([])
    expect(participant.facts.hand).toEqual(['strike'])
    expect(spectator.facts.handCounts).toEqual(participant.facts.handCounts)
  })

  it('reconnects from a safe projection and resets nested-response cues by projection', async () => {
    type Projection = { readonly revision: number; readonly stage: string }
    const handlers: LiveChannelHandlers<string, Projection, never, null>[] = []
    const scheduled: Array<() => void> = []
    const controller = new LiveProjectionController<string, Projection, never, null, never, number>(
      {
        observer: 'spectator',
        initialControlState: null,
        transport: {
          loadSnapshot: async () => ({ revision: 1, stage: 'main' }),
          openChannel: (_observer, nextHandlers) => {
            handlers.push(nextHandlers)
            return { send: () => true, close: () => undefined }
          },
        },
        scheduler: {
          set: (_delay, callback) => {
            scheduled.push(callback)
            return scheduled.length
          },
          clear: () => undefined,
        },
        observerKey: (observer) => observer,
        applyTransient: (projection) => projection,
        isSettled: () => false,
        isUnavailableError: () => false,
        disconnectedControlState: () => null,
      },
    )
    controller.start()
    await Promise.resolve()
    handlers[0]!.close()
    await Promise.resolve()
    await Promise.resolve()
    expect(controller.snapshot().projection).toEqual({ revision: 1, stage: 'main' })
    scheduled[0]!()
    expect(handlers).toHaveLength(2)

    const cues = new SequencedCueQueue<{ id: string; sequence: number }, string>({
      key: (cue) => cue.id,
      sequence: (cue) => cue.sequence,
    })
    cues.update({ cues: [], lastSequence: 1, projectionKey: 'spectator', enabled: true })
    cues.update({
      cues: [
        { id: 'strike', sequence: 2 },
        { id: 'response', sequence: 3 },
      ],
      lastSequence: 3,
      projectionKey: 'spectator',
      enabled: true,
    })
    expect(cues.snapshot().current?.id).toBe('strike')
    cues.completeCurrent()
    expect(cues.snapshot().current?.id).toBe('response')
    cues.update({ cues: [], lastSequence: 3, projectionKey: 'participant-one', enabled: true })
    expect(cues.snapshot().current).toBeNull()
  })
})
