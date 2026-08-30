import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { sourceFiles, text, localPath, failIfErrors, projectRoot } from './files.js'

const files = await sourceFiles(['.'], new Set(['.md']))
const errors: string[] = []

for (const path of files) {
  const relativePath = localPath(path)
  const content = await text(path)
  const lines = content.split(/\r?\n/).length
  if (relativePath.endsWith('AGENTS.md') && lines > 200) {
    errors.push(`${relativePath} has ${lines} lines; AGENTS files are limited to 200`)
  }
  if (relativePath === 'docs/architecture.md' && lines > 500) {
    errors.push(`${relativePath} has ${lines} lines; architecture documents are limited to 500`)
  }
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1]!
    if (/^(?:https?:|mailto:|#)/.test(target)) continue
    const localTarget = target.split('#')[0]!
    try {
      await access(resolve(dirname(path), localTarget))
    } catch {
      errors.push(`${relativePath} links to missing ${target}`)
    }
  }
}

for (const forbidden of ['AgentWolf', '原来', '替代旧', '相比上一版']) {
  const architecture = await text(resolve(projectRoot, 'docs/architecture.md'))
  if (architecture.includes(forbidden)) {
    errors.push(`docs/architecture.md contains non-current narrative ${forbidden}`)
  }
}

failIfErrors(errors, 'docs')
