import { describe, expect, it } from 'vitest'
import { PhaseGraphRegistry, type PhaseNode } from '../src/index.js'

interface Node extends PhaseNode<string> {
  readonly label: string
}

function node(
  id: string,
  edges: readonly { readonly to: string; readonly when?: string }[] = [],
): Node {
  return { id, label: id, edges }
}

describe('phase graph registry', () => {
  it('registers a base graph and applies ordered insertions without mutating source nodes', () => {
    const registered: string[] = []
    const registry = new PhaseGraphRegistry<string, Node>((id) => registered.push(id))
    const start = node('start', [{ to: 'end' }])
    registry.registerBase({
      id: 'round',
      entry: start.id,
      nodes: new Map([
        [start.id, start],
        ['end', node('end')],
      ]),
    })
    registry.insert({ node: node('middle'), after: 'start', before: 'end' })
    registry.insert({ node: node('opening'), after: null, before: 'start', rewireIncoming: true })

    const graph = registry.build()
    expect(graph.entry).toBe('opening')
    expect(graph.nodes.get('opening')?.edges).toEqual([{ to: 'start' }])
    expect(graph.nodes.get('start')?.edges).toEqual([{ to: 'middle' }])
    expect(graph.nodes.get('middle')?.edges).toEqual([{ to: 'end' }])
    expect(start.edges).toEqual([{ to: 'end' }])
    expect(registered).toEqual(['start', 'end', 'middle', 'opening'])
  })

  it('rejects invalid configuration, insertion, cycles, missing edges, and unreachable nodes', () => {
    expect(() => new PhaseGraphRegistry().build()).toThrow(/no configured phase graph/)

    const duplicate = new PhaseGraphRegistry<string, Node>()
    duplicate.configure({ id: 'graph', entry: 'start' })
    duplicate.register(node('start'))
    expect(() => duplicate.configure({ id: 'other', entry: 'start' })).toThrow(/Duplicate/)
    expect(() => duplicate.register(node('start'))).toThrow(/Duplicate/)
    expect(() => duplicate.insert({ node: node('start'), after: null, before: 'start' })).toThrow(
      /Duplicate/,
    )

    const missing = new PhaseGraphRegistry<string, Node>()
    missing.registerBase({
      id: 'missing',
      entry: 'start',
      nodes: new Map([['start', node('start', [{ to: 'missing' }])]]),
    })
    expect(() => missing.build()).toThrow(/targets missing/)

    const unreachable = new PhaseGraphRegistry<string, Node>()
    unreachable.registerBase({
      id: 'unreachable',
      entry: 'start',
      nodes: new Map([
        ['start', node('start')],
        ['orphan', node('orphan')],
      ]),
    })
    expect(() => unreachable.build()).toThrow(/unreachable/)

    const insertionCycle = new PhaseGraphRegistry<string, Node>()
    insertionCycle.registerBase({
      id: 'cycle',
      entry: 'end',
      nodes: new Map([['end', node('end')]]),
    })
    insertionCycle.insert({ node: node('one'), after: 'two', before: 'end' })
    insertionCycle.insert({ node: node('two'), after: 'one', before: 'end' })
    expect(() => insertionCycle.build()).toThrow(/insertion cycle/)
  })
})
