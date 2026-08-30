import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { discoverRepositoryFiles, readRepositoryText, repositoryPath } from './files.js'

export interface RepositoryPolicy {
  readonly name: string
  check(): Promise<readonly string[]>
}

export async function runRepositoryPolicies(policies: readonly RepositoryPolicy[]): Promise<void> {
  const results = await Promise.all(
    policies.map(async (policy) => ({ policy, errors: await policy.check() })),
  )
  const failures = results.flatMap(({ policy, errors }) =>
    errors.map((error) => `${policy.name}: ${error}`),
  )
  if (failures.length > 0) {
    throw new Error(
      `Repository policies failed:\n${failures.map((error) => `- ${error}`).join('\n')}`,
    )
  }
}

export function dependencyPolicy(options: {
  readonly projectRoot: string
  readonly scope: string
  readonly owners: Readonly<
    Record<
      string,
      {
        readonly sourceRoot: string
        readonly packageName: string
        readonly allowedDependencies: ReadonlySet<string>
      }
    >
  >
}): RepositoryPolicy {
  return {
    name: 'dependencies',
    check: async () => {
      const errors: string[] = []
      for (const [owner, config] of Object.entries(options.owners)) {
        const files = await discoverRepositoryFiles({
          projectRoot: options.projectRoot,
          roots: [config.sourceRoot],
          extensions: new Set(['.ts', '.tsx']),
        })
        for (const path of files) {
          const content = await readRepositoryText(path)
          for (const match of content.matchAll(
            new RegExp(
              `\\b(?:import|export)\\s+(?:type\\s+)?(?:[^'";]*?\\sfrom\\s*)?['"](${escapeRegExp(options.scope)}\\/[^'"]+)['"]`,
              'g',
            ),
          )) {
            const imported = match[1]?.slice(options.scope.length + 1).split('/')[0]
            if (!imported || imported === config.packageName) continue
            if (!config.allowedDependencies.has(imported)) {
              const line = content.slice(0, match.index).split(/\r?\n/).length
              errors.push(
                `${repositoryPath(options.projectRoot, path)}:${line} cannot import ${options.scope}/${imported}`,
              )
            }
          }
        }
        const manifestPath = resolve(options.projectRoot, owner, 'package.json')
        const manifest = JSON.parse(await readRepositoryText(manifestPath)) as {
          readonly name?: string
          readonly dependencies?: Readonly<Record<string, string>>
        }
        if (manifest.name !== `${options.scope}/${config.packageName}`) {
          errors.push(`${owner}/package.json must declare ${options.scope}/${config.packageName}`)
        }
        for (const dependency of config.allowedDependencies) {
          if (manifest.dependencies?.[`${options.scope}/${dependency}`] !== 'workspace:*') {
            errors.push(`${owner}/package.json must depend on ${options.scope}/${dependency}`)
          }
        }
      }
      return errors
    },
  }
}

export function fileLinePolicy(options: {
  readonly projectRoot: string
  readonly roots: readonly string[]
  readonly extensions: ReadonlySet<string>
  readonly maximumLines: number
  readonly overrides?: ReadonlyMap<string, number>
}): RepositoryPolicy {
  return {
    name: 'file-lines',
    check: async () => {
      const files = await discoverRepositoryFiles(options)
      const errors: string[] = []
      for (const path of files) {
        const local = repositoryPath(options.projectRoot, path)
        const maximum = options.overrides?.get(local) ?? options.maximumLines
        const lines = (await readRepositoryText(path)).split(/\r?\n/).length
        if (lines > maximum) errors.push(`${local} has ${lines} lines; maximum is ${maximum}`)
      }
      return errors
    },
  }
}

export function markdownLinkPolicy(options: {
  readonly projectRoot: string
  readonly roots: readonly string[]
}): RepositoryPolicy {
  return {
    name: 'markdown-links',
    check: async () => {
      const files = await discoverRepositoryFiles({
        projectRoot: options.projectRoot,
        roots: options.roots,
        extensions: new Set(['.md']),
      })
      const errors: string[] = []
      for (const path of files) {
        const content = await readRepositoryText(path)
        for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
          const target = match[1]!
          if (/^(?:https?:|mailto:|#)/.test(target)) continue
          try {
            await access(resolve(dirname(path), target.split('#')[0]!))
          } catch {
            errors.push(`${repositoryPath(options.projectRoot, path)} links to missing ${target}`)
          }
        }
      }
      return errors
    },
  }
}

export function requiredFilesPolicy(options: {
  readonly projectRoot: string
  readonly paths: readonly string[]
}): RepositoryPolicy {
  return {
    name: 'required-files',
    check: async () => {
      const errors: string[] = []
      for (const path of options.paths) {
        try {
          await access(resolve(options.projectRoot, path))
        } catch {
          errors.push(`missing ${path}`)
        }
      }
      return errors
    },
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
