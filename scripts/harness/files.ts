import { resolve } from 'node:path'
import {
  discoverRepositoryFiles,
  readRepositoryText,
  repositoryPath,
} from '../../packages/harness/src/index.js'

export const projectRoot = resolve(import.meta.dirname, '..', '..')

export async function sourceFiles(
  roots: readonly string[],
  extensions: ReadonlySet<string>,
  baseRoot = projectRoot,
): Promise<string[]> {
  return discoverRepositoryFiles({ projectRoot: baseRoot, roots, extensions })
}

export async function text(path: string): Promise<string> {
  return readRepositoryText(path)
}

export function localPath(path: string): string {
  return repositoryPath(projectRoot, path)
}

export function failIfErrors(errors: readonly string[], title: string): void {
  if (errors.length === 0) {
    process.stdout.write(`${title}: ok\n`)
    return
  }
  process.stderr.write(`${title} failed:\n${errors.map((error) => `- ${error}`).join('\n')}\n`)
  process.exitCode = 1
}
