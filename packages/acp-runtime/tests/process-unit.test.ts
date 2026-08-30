import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: mocks.spawn,
}))

import { AgentProcess } from '../src/process.js'

class FakeStream extends EventEmitter {
  public readonly setEncoding = vi.fn()
}

class FakeChild extends EventEmitter {
  public readonly stderr = new FakeStream()
  public readonly stdout = new FakeStream()
  public readonly stdin = new FakeStream()
  public exitCode: number | null = null
  public signalCode: NodeJS.Signals | null = null
  public pid: number | undefined = 321
  public readonly kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>(() => true)

  public exit(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
  }
}

let child: FakeChild

beforeEach(() => {
  child = new FakeChild()
  mocks.spawn.mockReset()
  mocks.spawn.mockReturnValue(child)
})

function create(options: { stderrLimit?: number; onStderr?: (chunk: string) => void } = {}) {
  return new AgentProcess({
    cwd: '/tmp/agent',
    launch: { command: 'agent-command', args: ['serve'], env: { TEST: '1' } },
    ...options,
  })
}

describe('AgentProcess unit behavior', () => {
  it('spawns the POSIX guardian, captures bounded stderr, and resolves exit events', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const onStderr = vi.fn()
    const agent = create({ stderrLimit: 5, onStderr })
    expect(mocks.spawn).toHaveBeenCalledWith(
      '/bin/sh',
      expect.arrayContaining(['agent-command', 'serve']),
      expect.objectContaining({ detached: true, shell: false }),
    )
    expect(agent.child).toBe(child)
    expect(child.stderr.setEncoding).toHaveBeenCalledWith('utf8')
    child.stderr.emit('data', 'abcdef')
    expect(agent.stderrTail).toBe('bcdef')
    expect(onStderr).toHaveBeenCalledWith('abcdef')
    const exited = agent.exited()
    child.exit(7, null)
    await expect(exited).resolves.toEqual({ code: 7, signal: null })
    await agent.close()
  })

  it('uses default stderr limits and rejects process errors while waiting', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const agent = create()
    child.stderr.emit('data', 'message')
    expect(agent.stderrTail).toBe('message')
    const exited = agent.exited()
    child.emit('error', new Error('spawn failed'))
    await expect(exited).rejects.toThrow('spawn failed')
  })

  it('closes a POSIX process group gracefully and only once', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const kill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 'SIGTERM') child.exit(null, 'SIGTERM')
      return true
    })
    const agent = create()
    await agent.close()
    await agent.close()
    expect(kill).toHaveBeenCalledTimes(1)
    expect(kill).toHaveBeenCalledWith(-321, 'SIGTERM')
  })

  it('escalates a timed-out POSIX close to SIGKILL', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const kill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 'SIGKILL') child.exit(null, 'SIGKILL')
      return true
    })
    const agent = create()
    await agent.close(0)
    expect(kill.mock.calls.map((call) => call[1])).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('tolerates ESRCH but propagates other group signal failures', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    vi.spyOn(process, 'kill').mockImplementation(() => {
      child.exitCode = 0
      throw Object.assign(new Error('gone'), { code: 'ESRCH' })
    })
    await expect(create().close()).resolves.toBeUndefined()

    vi.restoreAllMocks()
    child = new FakeChild()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    mocks.spawn.mockReturnValue(child)
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' })
    })
    await expect(create().close()).rejects.toThrow('denied')
  })

  it('spawns and signals the child directly on Windows', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    child.kill.mockImplementation((signal) => {
      child.exit(null, signal as NodeJS.Signals)
      return true
    })
    const agent = create()
    expect(mocks.spawn).toHaveBeenCalledWith(
      'agent-command',
      ['serve'],
      expect.objectContaining({ cwd: '/tmp/agent', shell: false }),
    )
    await agent.close()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })
})
