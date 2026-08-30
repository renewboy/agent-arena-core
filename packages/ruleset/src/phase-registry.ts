export interface PhaseEdge<NodeId extends string> {
  readonly to: NodeId
  readonly when?: string
}

export interface PhaseNode<NodeId extends string> {
  readonly id: NodeId
  readonly edges: readonly PhaseEdge<NodeId>[]
}

export interface PhaseGraph<NodeId extends string, Node extends PhaseNode<NodeId>> {
  readonly id: string
  readonly entry: NodeId
  readonly nodes: ReadonlyMap<NodeId, Node>
}

export interface PhaseInsertion<NodeId extends string, Node extends PhaseNode<NodeId>> {
  readonly node: Node
  readonly after: NodeId | null
  readonly before: NodeId
  readonly rewireIncoming?: boolean
}

export class PhaseGraphRegistry<
  NodeId extends string = string,
  Node extends PhaseNode<NodeId> = PhaseNode<NodeId>,
> {
  #graphId: string | null = null
  #entry: NodeId | null = null
  readonly #nodes = new Map<NodeId, Node>()
  readonly #insertions: Array<PhaseInsertion<NodeId, Node>> = []

  public constructor(private readonly onRegister?: (nodeId: NodeId) => void) {}

  public configure(options: { readonly id: string; readonly entry: NodeId }): void {
    if (this.#graphId) throw new Error(`Duplicate phase graph ${options.id}`)
    this.#graphId = options.id
    this.#entry = options.entry
  }

  public register(node: Node): void {
    if (this.#nodes.has(node.id) || this.#insertions.some((entry) => entry.node.id === node.id)) {
      throw new Error(`Duplicate phase node ${node.id}`)
    }
    this.onRegister?.(node.id)
    this.#nodes.set(node.id, cloneNode(node))
  }

  public registerAll(nodes: readonly Node[]): void {
    for (const node of nodes) this.register(node)
  }

  public registerBase(graph: PhaseGraph<NodeId, Node>): void {
    this.configure({ id: graph.id, entry: graph.entry })
    this.registerAll([...graph.nodes.values()])
  }

  public insert(insertion: PhaseInsertion<NodeId, Node>): void {
    if (
      this.#nodes.has(insertion.node.id) ||
      this.#insertions.some((entry) => entry.node.id === insertion.node.id)
    ) {
      throw new Error(`Duplicate phase insertion ${insertion.node.id}`)
    }
    this.onRegister?.(insertion.node.id)
    this.#insertions.push(insertion)
  }

  public build(): PhaseGraph<NodeId, Node> {
    if (!this.#graphId || !this.#entry) throw new Error('Ruleset has no configured phase graph')
    const nodes = new Map<NodeId, Node>([...this.#nodes].map(([id, node]) => [id, cloneNode(node)]))
    for (const insertion of this.#insertions) {
      if (nodes.has(insertion.node.id)) throw new Error(`Duplicate phase node ${insertion.node.id}`)
      nodes.set(insertion.node.id, withEdges(insertion.node, [{ to: insertion.before }]))
    }

    let entry = this.#entry
    for (const insertion of orderedInsertions(this.#insertions)) {
      if (!nodes.has(insertion.before)) {
        throw new Error(`Phase ${insertion.node.id} targets missing ${insertion.before}`)
      }
      if (insertion.after === null) {
        if (entry !== insertion.before) {
          throw new Error(
            `Phase ${insertion.node.id} cannot precede ${insertion.before}; current entry is ${entry}`,
          )
        }
        if (insertion.rewireIncoming) {
          for (const [nodeId, node] of nodes) {
            if (nodeId === insertion.node.id) continue
            const edges = node.edges.map((edge) =>
              edge.to === insertion.before ? { ...edge, to: insertion.node.id } : edge,
            )
            nodes.set(nodeId, withEdges(node, edges))
          }
        }
        entry = insertion.node.id
        continue
      }
      const previous = nodes.get(insertion.after)
      if (!previous)
        throw new Error(`Phase ${insertion.node.id} follows missing ${insertion.after}`)
      const edgeIndex = previous.edges.findIndex((edge) => edge.to === insertion.before)
      if (edgeIndex < 0) {
        throw new Error(
          `Phase ${insertion.node.id} cannot insert between ${insertion.after} and ${insertion.before}`,
        )
      }
      const edges = [...previous.edges]
      edges[edgeIndex] = { ...edges[edgeIndex]!, to: insertion.node.id }
      nodes.set(previous.id, withEdges(previous, edges))
    }

    for (const node of nodes.values()) {
      for (const edge of node.edges) {
        if (!nodes.has(edge.to)) throw new Error(`Phase ${node.id} targets missing ${edge.to}`)
      }
    }
    validateReachability(entry, nodes)
    return { id: this.#graphId, entry, nodes }
  }
}

function validateReachability<NodeId extends string, Node extends PhaseNode<NodeId>>(
  entry: NodeId,
  nodes: ReadonlyMap<NodeId, Node>,
): void {
  if (!nodes.has(entry)) throw new Error(`Phase graph entry ${entry} is missing`)
  const reachable = new Set<NodeId>()
  const pending = [entry]
  while (pending.length > 0) {
    const phaseId = pending.pop()!
    if (reachable.has(phaseId)) continue
    reachable.add(phaseId)
    const node = nodes.get(phaseId)
    if (!node) throw new Error(`Phase graph references missing ${phaseId}`)
    for (const edge of node.edges) pending.push(edge.to)
  }
  const unreachable = [...nodes.keys()].filter((phaseId) => !reachable.has(phaseId))
  if (unreachable.length > 0) {
    throw new Error(`Phase graph has unreachable nodes: ${unreachable.join(', ')}`)
  }
}

function orderedInsertions<NodeId extends string, Node extends PhaseNode<NodeId>>(
  insertions: readonly PhaseInsertion<NodeId, Node>[],
): Array<PhaseInsertion<NodeId, Node>> {
  const byNode = new Map(insertions.map((insertion) => [insertion.node.id, insertion]))
  const visiting = new Set<NodeId>()
  const visited = new Set<NodeId>()
  const ordered: Array<PhaseInsertion<NodeId, Node>> = []
  const visit = (insertion: PhaseInsertion<NodeId, Node>, path: readonly NodeId[]): void => {
    if (visited.has(insertion.node.id)) return
    if (visiting.has(insertion.node.id)) {
      throw new Error(`Phase insertion cycle: ${[...path, insertion.node.id].join(' -> ')}`)
    }
    visiting.add(insertion.node.id)
    if (insertion.after) {
      const dependency = byNode.get(insertion.after)
      if (dependency) visit(dependency, [...path, insertion.node.id])
    }
    visiting.delete(insertion.node.id)
    visited.add(insertion.node.id)
    ordered.push(insertion)
  }
  for (const insertion of insertions) visit(insertion, [])
  return ordered
}

function cloneNode<NodeId extends string, Node extends PhaseNode<NodeId>>(node: Node): Node {
  return withEdges(node, [...node.edges])
}

function withEdges<NodeId extends string, Node extends PhaseNode<NodeId>>(
  node: Node,
  edges: readonly PhaseEdge<NodeId>[],
): Node {
  return { ...node, edges: [...edges] } as Node
}
