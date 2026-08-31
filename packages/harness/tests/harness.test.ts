import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  discoverRepositoryFiles,
  dependencyPolicy,
  fileLinePolicy,
  markdownLinkPolicy,
  readRepositoryText,
  repositoryPath,
  requiredFilesPolicy,
  runGatePhases,
  runRepositoryPolicies,
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

  it('runs configurable dependency, line, link, and required-file policies', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'arena-policies-'))
    roots.push(root)
    await mkdir(resolve(root, 'packages', 'one', 'src'), { recursive: true })
    await mkdir(resolve(root, 'packages', 'two', 'src'), { recursive: true })
    await mkdir(resolve(root, 'docs'))
    await writeFile(
      resolve(root, 'packages', 'one', 'package.json'),
      JSON.stringify({ name: '@scope/one', dependencies: { '@scope/two': 'workspace:*' } }),
    )
    await writeFile(
      resolve(root, 'packages', 'two', 'package.json'),
      JSON.stringify({ name: '@scope/two' }),
    )
    await writeFile(
      resolve(root, 'packages', 'one', 'src', 'index.ts'),
      "export * from '@scope/two'\n",
    )
    await writeFile(
      resolve(root, 'packages', 'two', 'src', 'index.ts'),
      'export const two = true\n',
    )
    await writeFile(resolve(root, 'docs', 'target.md'), '# Target\n')
    await writeFile(resolve(root, 'README.md'), '[Target](docs/target.md)\n')
    const owners = {
      'packages/one': {
        sourceRoot: 'packages/one/src',
        packageName: 'one',
        allowedDependencies: new Set(['two']),
      },
      'packages/two': {
        sourceRoot: 'packages/two/src',
        packageName: 'two',
        allowedDependencies: new Set<string>(),
      },
    }
    await expect(
      runRepositoryPolicies([
        dependencyPolicy({ projectRoot: root, scope: '@scope', owners }),
        fileLinePolicy({
          projectRoot: root,
          roots: ['packages'],
          extensions: new Set(['.ts']),
          maximumLines: 5,
        }),
        markdownLinkPolicy({ projectRoot: root, roots: ['.'] }),
        requiredFilesPolicy({ projectRoot: root, paths: ['README.md'] }),
      ]),
    ).resolves.toBeUndefined()

    await writeFile(resolve(root, 'packages', 'two', 'src', 'bad.ts'), "import '@scope/one'\n")
    await writeFile(
      resolve(root, 'packages', 'one', 'package.json'),
      JSON.stringify({
        name: '@scope/wrong',
        dependencies: { '@scope/three': 'workspace:*' },
      }),
    )
    await writeFile(resolve(root, 'README.md'), '[Missing](docs/missing.md)\n')
    await expect(
      runRepositoryPolicies([
        dependencyPolicy({ projectRoot: root, scope: '@scope', owners }),
        fileLinePolicy({
          projectRoot: root,
          roots: ['packages'],
          extensions: new Set(['.ts']),
          maximumLines: 0,
        }),
        markdownLinkPolicy({ projectRoot: root, roots: ['.'] }),
        requiredFilesPolicy({ projectRoot: root, paths: ['missing.txt'] }),
      ]),
    ).rejects.toThrow(
      /dependencies:.*disallowed dependency.*cannot import.*file-lines:.*markdown-links:.*required-files:/s,
    )
  })
})
