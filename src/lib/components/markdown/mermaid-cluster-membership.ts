import type { FlowSubGraph } from 'mermaid/dist/diagrams/flowchart/types';

export type FlowchartClusterMembership = ReadonlyMap<string, ReadonlySet<string>>;

/** Copy Mermaid's semantic subgraphs before the next parse clears its database. */
export function snapshotFlowchartClusterMembership(
  groups: Pick<FlowSubGraph, 'id' | 'nodes'>[],
): FlowchartClusterMembership {
  const direct = new Map(groups.map(({ id, nodes }) => [id, [...nodes]]));
  const result = new Map<string, ReadonlySet<string>>();
  for (const id of direct.keys()) {
    const members = new Set<string>();
    const visit = (child: string) => {
      if (child === id || members.has(child)) return;
      members.add(child);
      for (const descendant of direct.get(child) ?? []) visit(descendant);
    };
    for (const child of direct.get(id) ?? []) visit(child);
    result.set(id, members);
  }
  return result;
}

export function flowchartClusterId(
  cluster: SVGGElement,
  membership: FlowchartClusterMembership,
): string | undefined {
  if (membership.has(cluster.id)) return cluster.id;
  // The presentation layer can namespace SVG ids; authored ids may contain hyphens.
  return [...membership.keys()]
    .filter((id) => cluster.id.endsWith(`-${id}`))
    .toSorted((left, right) => right.length - left.length)[0];
}
