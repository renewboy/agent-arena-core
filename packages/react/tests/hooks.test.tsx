// @vitest-environment jsdom

import { StrictMode, useMemo } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import {
  FollowLatestController,
  LiveProjectionController,
  PresentationPlaybackController,
  SequencedCueQueue,
} from '@agent-arena/web-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  useAsyncAction,
  useFollowLatest,
  useLiveProjection,
  usePresentationPlayback,
  useSequencedCues,
} from '../src/index.js'

afterEach(() => cleanup())

describe('runtime hooks', () => {
  it('starts once in StrictMode and disposes after the final unmount', async () => {
    const close = vi.fn()
    const load = vi.fn(async () => ({ value: 'loaded' }))
    const controller = new LiveProjectionController({
      observer: 'host',
      initialControlState: null,
      transport: {
        loadSnapshot: load,
        openChannel: () => ({ send: () => true, close }),
      },
      scheduler: { set: () => 1, clear: () => undefined },
      observerKey: (observer) => observer,
      applyTransient: (projection: { value: string }) => projection,
      isSettled: () => false,
      isUnavailableError: () => false,
      disconnectedControlState: () => null,
    })
    const hook = renderHook(() => useLiveProjection(controller), { wrapper: StrictMode })
    await waitFor(() => expect(hook.result.current.projection).toEqual({ value: 'loaded' }))
    expect(load).toHaveBeenCalledOnce()
    hook.unmount()
    await act(async () => Promise.resolve())
    expect(close).toHaveBeenCalledOnce()
  })

  it('subscribes follow-latest and sequenced cue state', async () => {
    const follow = new FollowLatestController()
    const followed = renderHook(() => useFollowLatest(follow))
    act(() => follow.detach())
    expect(followed.result.current.following).toBe(false)

    const queue = new SequencedCueQueue<{ id: string; sequence: number }, string>({
      key: (cue) => cue.id,
      sequence: (cue) => cue.sequence,
    })
    const cues = renderHook(
      ({ lastSequence }) =>
        useSequencedCues(queue, {
          cues: lastSequence > 1 ? [{ id: 'cue', sequence: 2 }] : [],
          lastSequence,
          projectionKey: 'host',
          enabled: true,
        }),
      { initialProps: { lastSequence: 1 } },
    )
    cues.rerender({ lastSequence: 2 })
    await waitFor(() => expect(cues.result.current.current?.id).toBe('cue'))
  })

  it('updates presentation input and exposes controller state', async () => {
    const spoken: Array<() => void> = []
    const controller = new PresentationPlaybackController<
      { sequence: number; actor: string; text: string },
      string
    >({
      port: {
        supported: true,
        speak: (_text, callbacks) => spoken.push(() => callbacks.end()),
        cancel: () => undefined,
      },
      isPresentable: () => true,
      sequence: (item) => item.sequence,
      actor: (item) => item.actor,
      text: (item) => item.text,
      segment: () => ({ segments: [], consumedLength: 0 }),
      sameActor: (left, right) => left === right,
      resolve: () => true,
    })
    const hook = renderHook(() => {
      const update = useMemo(
        () => ({
          items: [{ sequence: 1, actor: 'one', text: 'Hello' }],
          activeStream: null,
          controlled: true,
          pendingSequence: 1,
          projectionKey: 'host',
          observerPending: false,
        }),
        [],
      )
      return usePresentationPlayback(controller, update)
    })
    await waitFor(() => expect(hook.result.current.automaticSequence).toBe(1))
    act(() => spoken[0]!())
    expect(hook.result.current.automaticBusy).toBe(false)
  })
})

describe('useAsyncAction', () => {
  it('tracks success, error, and reset', async () => {
    const action = vi.fn(async (value: string) => {
      if (value === 'fail') throw 'failure'
      return value.toUpperCase()
    })
    const hook = renderHook(() => useAsyncAction(action))
    await act(async () => {
      await expect(hook.result.current.run('ok')).resolves.toBe('OK')
    })
    expect(hook.result.current).toMatchObject({ status: 'success', result: 'OK', error: null })
    await act(async () => {
      await expect(hook.result.current.run('fail')).rejects.toThrow('failure')
    })
    expect(hook.result.current.status).toBe('error')
    expect(hook.result.current.error?.message).toBe('failure')
    act(() => hook.result.current.reset())
    expect(hook.result.current.status).toBe('idle')
  })

  it('ignores stale and unmounted completions and preserves Error instances', async () => {
    const resolvers: Array<(value: string) => void> = []
    const hook = renderHook(() =>
      useAsyncAction(
        (value: string) => new Promise<string>((resolve) => resolvers.push(() => resolve(value))),
      ),
    )
    let first!: Promise<string>
    let second!: Promise<string>
    act(() => {
      first = hook.result.current.run('first')
      second = hook.result.current.run('second')
    })
    await act(async () => resolvers[0]!('first'))
    await expect(first).resolves.toBe('first')
    expect(hook.result.current.status).toBe('working')
    await act(async () => resolvers[1]!('second'))
    await expect(second).resolves.toBe('second')
    expect(hook.result.current.result).toBe('second')

    const failure = renderHook(() =>
      useAsyncAction(async () => {
        throw new TypeError('typed failure')
      }),
    )
    await act(async () => {
      await expect(failure.result.current.run()).rejects.toBeInstanceOf(TypeError)
    })

    const pending = renderHook(() =>
      useAsyncAction(() => new Promise<string>((resolve) => resolvers.push(() => resolve('late')))),
    )
    const late = pending.result.current.run()
    pending.unmount()
    await act(async () => resolvers.at(-1)!('late'))
    await expect(late).resolves.toBe('late')
  })
})
