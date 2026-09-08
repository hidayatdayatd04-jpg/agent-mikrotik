import { graphlib, layout } from "@dagrejs/dagre";
import { Position, type Edge, type Node } from "@xyflow/react";
import { matchesNetworkNode, type NetworkMapSnapshot, type NetworkNode, type NetworkNodeKind } from "@shared/network-map";

export type MapFlowNode = Node<{ device: NetworkNode }, "device">;
export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 88;
export const PAGE_SIZE = 160;

export function selectMapNodes(snapshot: NetworkMapSnapshot, query: string, kinds: NetworkNodeKind[], page: number) {
  const matching = snapshot.nodes.filter(n => kinds.includes(n.kind) && matchesNetworkNode(n, query));
  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const selected = matching.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const ids = new Set(selected.map(n => n.id));
  // Include known ancestors for context when searching/paging, respecting filters.
  const incoming = new Map<string, string[]>();
  const byId = new Map(snapshot.nodes.map(n => [n.id, n]));
  for (const edge of snapshot.edges) {
    const list = incoming.get(edge.target) ?? [];
    list.push(edge.source); incoming.set(edge.target, list);
  }
  const queue = [...ids];
  for (let i = 0; i < queue.length && ids.size < 400; i++) {
    for (const parent of incoming.get(queue[i]!) ?? []) {
      if (!ids.has(parent) && kinds.includes(byId.get(parent)!.kind) && ids.size < 400) { ids.add(parent); queue.push(parent); }
    }
  }
  return { matching, selected, pageCount, page: safePage, nodes: snapshot.nodes.filter(n => ids.has(n.id)),
    edges: snapshot.edges.filter(e => ids.has(e.source) && ids.has(e.target)) };
}

export function layoutMap(nodes: NetworkNode[], edges: NetworkMapSnapshot["edges"]): { nodes: MapFlowNode[]; edges: Edge[] } {
  const graph = new graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", nodesep: 30, ranksep: 90, marginx: 24, marginy: 24, ranker: "longest-path" });
  for (const node of nodes) graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of edges) graph.setEdge(edge.source, edge.target);
  layout(graph);
  return {
    nodes: nodes.map(device => {
      const point = graph.node(device.id);
      return { id: device.id, type: "device", data: { device }, width: NODE_WIDTH, height: NODE_HEIGHT,
        position: { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 },
        sourcePosition: Position.Right, targetPosition: Position.Left, ariaLabel: `${device.label}, ${device.kind}, ${device.status}` };
    }),
    edges: edges.map(edge => ({ ...edge, type: "smoothstep", label: undefined, ariaLabel: edge.label,
      style: { stroke: edge.evidence === "inferred" ? "#b7791f" : "var(--muted-foreground)", strokeWidth: 1.3,
        strokeDasharray: edge.evidence === "inferred" ? "5 5" : undefined },
    })),
  };
}
