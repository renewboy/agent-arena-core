import { spawnSync } from 'node:child_process'

function gitConfig(scope, key) {
  const result = spawnSync('git', ['config', scope, '--get', key], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

const localHooksPath = gitConfig('--local', 'core.hooksPath')
const globalHooksPath = gitConfig('--global', 'core.hooksPath')

if (!localHooksPath && globalHooksPath) {
  process.stdout.write(
    `Agent Arena Core hooks use the managed global hooks path ${globalHooksPath}.\n`,
  )
  process.exitCode = 0
} else {
  const command = process.platform === 'win32' ? 'lefthook.exe' : 'lefthook'
  const result = spawnSync(command, ['install'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  process.exitCode = result.status ?? 1
}
