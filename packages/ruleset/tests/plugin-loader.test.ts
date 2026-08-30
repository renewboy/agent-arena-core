import { PluginIdSchema } from '@agent-arena/contracts'
import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { installRulePlugins, type RulePlugin } from '../src/index.js'

interface Registrar {
  readonly installed: string[]
}

function plugin(
  id: string,
  options: { readonly version?: number; readonly requires?: readonly [string, number][] } = {},
): RulePlugin<Registrar> {
  return {
    id: PluginIdSchema.parse(id),
    version: options.version ?? 1,
    ...(options.requires
      ? {
          requires: options.requires.map(([requiredId, version]) => ({
            id: PluginIdSchema.parse(requiredId),
            version,
          })),
        }
      : {}),
    register: (registrar) => registrar.installed.push(id),
  }
}

describe('rule plugin loader', () => {
  it('installs dependencies before dependents with stable ordering', () => {
    const registrar: Registrar = { installed: [] }
    const installed = installRulePlugins(registrar, [
      plugin('plugin-extension-one', { requires: [['plugin-base', 1]] }),
      plugin('plugin-base'),
      plugin('plugin-extension-two', { requires: [['plugin-base', 1]] }),
    ])

    expect(registrar.installed).toEqual([
      'plugin-base',
      'plugin-extension-one',
      'plugin-extension-two',
    ])
    expect(installed.map((entry) => entry.order)).toEqual([0, 1, 2])
  })

  it('rejects duplicates, missing versions, and dependency cycles', () => {
    expect(() =>
      installRulePlugins({ installed: [] }, [plugin('plugin-one'), plugin('plugin-one')]),
    ).toThrow(/Duplicate plugin/)
    expect(() =>
      installRulePlugins({ installed: [] }, [
        plugin('plugin-one', { requires: [['plugin-missing', 1]] }),
      ]),
    ).toThrow(/requires missing/)
    expect(() =>
      installRulePlugins({ installed: [] }, [
        plugin('plugin-one', { requires: [['plugin-two', 1]] }),
        plugin('plugin-two', { requires: [['plugin-one', 1]] }),
      ]),
    ).toThrow(/dependency cycle/)
    expect(() =>
      installRulePlugins({ installed: [] }, [
        { ...plugin('plugin-configured'), config: { enabled: true } },
      ]),
    ).toThrow(/config without a schema/)
    expect(() =>
      installRulePlugins({ installed: [] }, [{ ...plugin('plugin-zero'), version: 0 }]),
    ).toThrow(/invalid version/)
    expect(() =>
      installRulePlugins({ installed: [] }, [
        plugin('plugin-base', { version: 2 }),
        plugin('plugin-extension', { requires: [['plugin-base', 1]] }),
      ]),
    ).toThrow(/requires plugin-base@1/)
  })

  it('parses configuration and closes an install scope after registration failure', () => {
    const lifecycle: string[] = []
    const registrar = {
      installed: [] as string[],
      beginPluginInstall: (id: string) => lifecycle.push(`begin:${id}`),
      endPluginInstall: (id: string) => lifecycle.push(`end:${id}`),
    }
    const configured: RulePlugin<typeof registrar> = {
      ...plugin('plugin-configured'),
      config: { enabled: true },
      configSchema: z.object({ enabled: z.boolean() }),
      register: (target) => target.installed.push('configured'),
    }
    expect(installRulePlugins(registrar, [configured])[0]?.config).toEqual({ enabled: true })
    expect(lifecycle).toEqual(['begin:plugin-configured', 'end:plugin-configured'])

    const failed: RulePlugin<typeof registrar> = {
      ...plugin('plugin-failed'),
      register: () => {
        throw new Error('registration failed')
      },
    }
    expect(() => installRulePlugins(registrar, [failed])).toThrow('registration failed')
    expect(lifecycle.slice(-2)).toEqual(['begin:plugin-failed', 'end:plugin-failed'])
  })
})
