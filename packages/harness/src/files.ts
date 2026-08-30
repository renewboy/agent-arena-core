import { lstat, readdir, readFile } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'

export async function discoverRepositoryFiles(options: {
  readonly projectRoot: string
  readonly roots: readonly string[]
  readonly extensions: ReadonlySet<string>
  readonly ignoredNames?: ReadonlySet<string>
}): Promise<string[]> {
  const files: string[] = []
  for (const root of options.roots) {
    await walk(
      resolve(options.projectRoot, root),
      files,
      options.extensions,
      options.ignoredNames ?? defaultIgnoredNames,
    )
  }
  return files.sort()
}

export function repositoryPath(projectRoot: string, path: string): string {
  return relative(projectRoot, path).replaceAll('\\', '/')
}

export function readRepositoryText(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

async function walk(
  path: string,
  files: string[],
  extensions: ReadonlySet<string>,
  ignoredNames: ReadonlySet<string>,
): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true })
  for (const entry of entries) {
    if (ignoredNames.has(entry.name)) continue
    const child = resolve(path, entry.name)
    if (entry.isDirectory() && !(await isNestedRepository(child))) {
      await walk(child, files, extensions, ignoredNames)
    } else if (extensions.has(extname(entry.name))) {
      files.push(child)
    }
  }
}

const defaultIgnoredNames = new Set(['.git', 'coverage', 'dist', 'dist-types', 'node_modules'])

async function isNestedRepository(path: string): Promise<boolean> {
  try {
    const marker = await lstat(resolve(path, '.git'))
    return marker.isFile() || marker.isDirectory()
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}
