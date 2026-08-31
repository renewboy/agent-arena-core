import { MatchIdSchema, type Observer } from '@agent-arena/contracts'
import {
  LiveProjectionController,
  PresentationBarrierCoordinator,
  type LiveChannelHandlers,
  type LiveClientCommand,
} from '@agent-arena/web-runtime'
import { describe, expect, it, vi } from 'vitest'
import { createHiddenTeamModule, hiddenTeamSetup } from '../src/index.js'

describe('Hidden Team web runtime conformance', () => {
  it('switches authorized projections and applies only public stream deltas', async () => {
    const module = createHiddenTeamModule()
    const machine = module.create({
      matchId: MatchIdSchema.parse('match-hidden-web'),
      setup: hiddenTeamSetup(),
      seed: 1,
    })
    type Projection = {
      readonly observation: ReturnType<typeof module.observe>
      readonly stream: string
    }
    let handlers: LiveChannelHandlers<Observer, Projection, string, null> | null = null
    const commands: LiveClientCommand<Observer, never>[] = []
    const controller = new LiveProjectionController<
      Observer,
      Projection,
      string,
      null,
      never,
      number
    >({
      observer: { kind: 'spectator' },
      initialControlState: null,
      transport: {
        loadSnapshot: async (observer) => ({
          observation: module.observe(machine, observer),
          stream: '',
        }),
        openChannel: (_observer, nextHandlers) => {
          handlers = nextHandlers
          return {
            send: (command) => {
              commands.push(command)
              return true
            },
            close: () => undefined,
          }
        },
      },
      scheduler: { set: () => 1, clear: () => undefined },
      observerKey,
      applyTransient: (projection, value) => ({ ...projection, stream: projection.stream + value }),
      isSettled: (projection) => projection.observation.facts.stage === 'ended',
      isUnavailableError: () => false,
      disconnectedControlState: () => null,
    })
    controller.start()
    await Promise.resolve()
    expect(controller.snapshot().projection?.observation.facts.ownSecret).toBeNull()

    const participant = {
      kind: 'participant' as const,
      participantId: hiddenTeamSetup().participants[0]!.id,
    }
    controller.setObserver(participant)
    expect(controller.snapshot().observerPending).toBe(true)
    expect(commands).toEqual([{ type: 'observer.set', observer: participant }])
    handlers!.event({
      type: 'snapshot',
      observer: participant,
      projection: { observation: module.observe(machine, participant), stream: '' },
    })
    handlers!.event({ type: 'transient', value: 'public clue' })
    expect(controller.snapshot().projection?.observation.facts.ownSecret).toBe('ember')
    expect(controller.snapshot().projection?.stream).toBe('public clue')
  })

  it('releases a group-private presentation when the controller changes observer', async () => {
    const changed = vi.fn()
    const connection = { observer: { kind: 'host' } as Observer }
    const barrier = new PresentationBarrierCoordinator<
      typeof connection,
      Observer,
      { readonly sequence: number; readonly groupId: string },
      number
    >({
      key: (item) => item.sequence,
      observer: (value) => value.observer,
      isVisible: (item, observer) =>
        observer.kind === 'host' ||
        (observer.kind === 'participant' && observer.participantId.includes(item.groupId)),
      onStateChange: changed,
    })
    barrier.setEnabled(connection, true)
    const pending = barrier.waitFor({ sequence: 4, groupId: 'red' })
    connection.observer = { kind: 'spectator' }
    barrier.observerChanged(connection)
    await expect(pending).resolves.toBe('skipped')
    expect(changed).toHaveBeenCalled()
  })
})

function observerKey(observer: Observer): string {
  return observer.kind === 'participant'
    ? `${observer.kind}:${observer.participantId}`
    : observer.kind
}
