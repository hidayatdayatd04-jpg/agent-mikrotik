/** A passive observation, never a claim about end-to-end Internet reachability. */
export type NetworkNodeKind = "router" | "interface" | "bridge" | "vlan" | "subnet" | "client" | "gateway";
export type NetworkStatus = "online" | "offline" | "unknown";
export type NetworkEvidence = "configuration" | "dhcp" | "arp" | "neighbor" | "inferred";

export interface NetworkNode {
  id: string;
  kind: NetworkNodeKind;
  label: string;
  status: NetworkStatus;
  statusReason: string;
  sources: NetworkEvidence[];
  ips: string[];
  mac: string | null;
  interfaceName: string | null;
  vlanId: string | null;
  /** Explicitly selected fields only; no raw RouterOS rows or credentials. */
  details: Record<string, string | number | boolean | null>;
}

export interface NetworkEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  evidence: NetworkEvidence;
}

export interface NetworkDataset {
  name: string;
  status: "ok" | "unavailable" | "truncated";
  rows: number;
}

export interface NetworkMapSnapshot {
  connectionId: string;
  collectedAt: string;
  state: "success" | "partial" | "empty" | "disconnected" | "error";
  message: string | null;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  datasets: NetworkDataset[];
  warnings: string[];
  cached: boolean;
}

export const NETWORK_NODE_KINDS: NetworkNodeKind[] = ["gateway", "router", "interface", "bridge", "vlan", "subnet", "client"];

/** Logical attachment path, not a packet trace or a routing-policy evaluation. */
export function networkAttachmentPath(snapshot: Pick<NetworkMapSnapshot, "nodes" | "edges">, nodeId: string): NetworkEdge[] {
  const incoming = new Map<string, NetworkEdge[]>();
  for (const edge of snapshot.edges) {
    const list = incoming.get(edge.target) ?? [];
    list.push(edge);
    incoming.set(edge.target, list);
  }
  const queue = [nodeId];
  const visited = new Set(queue);
  const next = new Map<string, NetworkEdge>();
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    if (current === "router") {
      const path: NetworkEdge[] = [];
      let cursor = current;
      while (next.has(cursor)) { const edge = next.get(cursor)!; path.push(edge); cursor = edge.target; }
      return path.reverse();
    }
    for (const edge of [...(incoming.get(current) ?? [])].sort((a, b) => Number(a.evidence === "inferred") - Number(b.evidence === "inferred"))) {
      if (visited.has(edge.source)) continue;
      visited.add(edge.source); next.set(edge.source, edge); queue.push(edge.source);
    }
  }
  return [];
}

export function matchesNetworkNode(node: NetworkNode, query: string): boolean {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  return [node.label, ...node.ips, node.mac, node.interfaceName, node.vlanId ? `vlan ${node.vlanId}` : null]
    .filter(Boolean).join(" ").toLowerCase().includes(text);
}
