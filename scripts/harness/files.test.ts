import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sourceFiles } from './files.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('repository file discovery', () => {
  it('stops at nested Git repository and submodule boundaries', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'agent-arena-files-'))
    roots.push(root)
    await mkdir(resolve(root, 'src'), { recursive: true })
    await mkdir(resolve(root, 'vendor', 'submodule'), { recursive: true })
    await mkdir(resolve(root, 'vendor', 'repository', '.git'), { recursive: true })
    await writeFile(resolve(root, 'src', 'kept.ts'), 'export const kept = true\n')
    await writeFile(resolve(root, 'vendor', 'submodule', '.git'), 'gitdir: ../modules/submodule\n')
    await writeFile(resolve(root, 'vendor', 'submodule', 'ignored.ts'), 'ignored\n')
    await writeFile(resolve(root, 'vendor', 'repository', 'ignored.ts'), 'ignored\n')

    await expect(sourceFiles(['.'], new Set(['.ts']), root)).resolves.toEqual([
      resolve(root, 'src', 'kept.ts'),
    ])
  })
})
