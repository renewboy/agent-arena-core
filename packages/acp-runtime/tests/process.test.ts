import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentProcess } from '../src/process.js'

const roots: string[] = []
const ownedPids = new Set<number>()
const treeAgent = fileURLToPath(new URL('./fixtures/process-tree-agent.mjs', import.meta.url))
const treeParent = fileURLToPath(new URL('./fixtures/process-tree-parent.mjs', import.meta.url))
const guardian = fileURLToPath(new URL('../process-guardian.sh', import.meta.url))

afterEach(async () => {
  for (const pid of ownedPids) killOwned(pid)
  ownedPids.clear()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('ACP process guardian', () => {
  it('terminates an ACP process and its descendants on normal close', async () => {
    const { root, infoPath } = await processTreePaths()
    const agent = new AgentProcess({
      cwd: root,
      launch: {
        command: process.execPath,
        args: [treeAgent],
        env: { ...process.env, AGENT_ARENA_PROCESS_TREE_INFO: infoPath },
      },
    })
    if (agent.child.pid) ownedPids.add(agent.child.pid)
    const info = (await readJson(infoPath)) as ProcessTreeInfo
    ownedPids.add(info.agentPid)
    ownedPids.add(info.childPid)

    await agent.close()

    await expectProcessesGone([info.agentPid, info.childPid])
  }, 10_000)

  it('terminates the guarded tree when the Agent Arena parent is killed', async () => {
    const { root, infoPath, readyPath } = await processTreePaths()
    const parent = spawn(process.execPath, [treeParent, guardian, treeAgent, infoPath, readyPath], {
      cwd: root,
      stdio: 'ignore',
    })
    if (!parent.pid) throw new Error('Process-tree parent did not start')
    ownedPids.add(parent.pid)
    const [{ guardianPid }, info] = await Promise.all([
      readJson(readyPath) as Promise<{ guardianPid: number }>,
      readJson(infoPath) as Promise<ProcessTreeInfo>,
    ])
    ownedPids.add(guardianPid)
    ownedPids.add(info.agentPid)
    ownedPids.add(info.childPid)

    parent.kill('SIGKILL')
    await childExit(parent)

    await expectProcessesGone([guardianPid, info.agentPid, info.childPid])
  }, 10_000)
})

interface ProcessTreeInfo {
  readonly agentPid: number
  readonly childPid: number
}

async function processTreePaths(): Promise<{
  root: string
  infoPath: string
  readyPath: string
}> {
  const root = await mkdtemp(resolve(tmpdir(), 'agent-arena-process-tree-'))
  roots.push(root)
  return { root, infoPath: resolve(root, 'tree.json'), readyPath: resolve(root, 'ready.json') }
}

async function readJson(path: string): Promise<unknown> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as unknown
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
    }
  }
  throw new Error(`Timed out waiting for ${path}`)
}

async function expectProcessesGone(pids: readonly number[]): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (pids.every((pid) => !processExists(pid))) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
  }
  expect(pids.filter(processExists), 'guarded process IDs still exist').toEqual([])
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    throw error
  }
}

function killOwned(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL')
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
  }
}

function childExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolvePromise) => child.once('exit', () => resolvePromise()))
}
