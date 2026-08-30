import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  discoverRepositoryFiles,
  readRepositoryText,
  repositoryPath,
  runGatePhases,
  type RepositoryGate,
} from '../src/index.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('repository harness', () => {
  it('discovers source files while stopping at generated and nested repository boundaries', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'arena-harness-'))
    roots.push(root)
    await mkdir(resolve(root, 'src'))
    await mkdir(resolve(root, 'node_modules', 'ignored'), { recursive: true })
    await mkdir(resolve(root, 'vendor', 'child'), { recursive: true })
    await writeFile(resolve(root, 'src', 'kept.ts'), 'export const kept = true\n')
    await writeFile(resolve(root, 'src', 'ignored.js'), 'ignored\n')
    await writeFile(resolve(root, 'vendor', 'child', '.git'), 'gitdir: ../modules/child\n')
    await writeFile(resolve(root, 'vendor', 'child', 'ignored.ts'), 'ignored\n')
    await expect(
      discoverRepositoryFiles({
        projectRoot: root,
        roots: ['.'],
        extensions: new Set(['.ts']),
      }),
    ).resolves.toEqual([resolve(root, 'src', 'kept.ts')])
    await expect(readRepositoryText(resolve(root, 'src', 'kept.ts'))).resolves.toContain('kept')
    expect(repositoryPath(root, resolve(root, 'src', 'kept.ts'))).toBe('src/kept.ts')
  })

  it('runs gates in parallel phases and stops after the first failed phase', async () => {
    const phases: readonly (readonly RepositoryGate[])[] = [
      [
        { label: 'one', command: 'test', args: [] },
        { label: 'two', command: 'test', args: [] },
      ],
      [{ label: 'three', command: 'test', args: [] }],
    ]
    const started: string[] = []
    const executed: string[] = []
    await expect(
      runGatePhases(phases, {
        onStart: (gate) => started.push(gate.label),
        execute: async (gate) => {
          executed.push(gate.label)
          return gate.label === 'two' ? 1 : 0
        },
      }),
    ).rejects.toThrow(/two/)
    expect(started).toEqual(['one', 'two'])
    expect(executed).toEqual(['one', 'two'])
  })

  it('supports the default non-shell executor and cwd', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'arena-harness-cwd-'))
    roots.push(root)
    await expect(
      runGatePhases(
        [[{ label: 'node', command: process.execPath, args: ['-e', 'process.exit(0)'] }]],
        { cwd: root },
      ),
    ).resolves.toBeUndefined()
    await expect(
      runGatePhases([
        [
          {
            label: 'signal',
            command: process.execPath,
            args: ['-e', "process.kill(process.pid, 'SIGTERM')"],
          },
        ],
      ]),
    ).rejects.toThrow(/signal/)
    await expect(
      runGatePhases([[{ label: 'missing', command: resolve(root, 'missing-command'), args: [] }]]),
    ).rejects.toThrow()
  })
})
