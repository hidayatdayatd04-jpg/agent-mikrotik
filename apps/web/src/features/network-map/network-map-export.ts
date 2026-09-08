import { getSmoothStepPath, Position } from "@xyflow/react";
import type { NetworkMapSnapshot } from "@shared/network-map";
import { NODE_HEIGHT, NODE_WIDTH, type layoutMap } from "./network-graph";

export type MapExportFormat = "png" | "pdf" | "svg";
type Graph = ReturnType<typeof layoutMap>;
const colors = { gateway: "#64748b", router: "#0891b2", interface: "#2563eb", bridge: "#7c3aed", vlan: "#b45309", subnet: "#0f766e", client: "#4f46e5" };
const labels = { gateway: "Gateway", router: "Router", interface: "Interface", bridge: "Bridge", vlan: "VLAN", subnet: "Subnet", client: "Klien" };
const escapeXml = (value: string) => value.replace(/[<>&"']/g, char => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);
const shorten = (value: string, length: number) => Array.from(value).length > length ? Array.from(value).slice(0, length - 1).join("") + "…" : value;

/** Render from graph data, including nodes culled by the interactive viewport. */
export function createMapSvg(graph: Graph, snapshot: NetworkMapSnapshot, scope: string) {
  if (!graph.nodes.length) throw new Error("Tidak ada perangkat untuk diekspor.");
  const minX = Math.min(...graph.nodes.map(n => n.position.x));
  const minY = Math.min(...graph.nodes.map(n => n.position.y));
  const width = Math.max(640, Math.ceil(Math.max(...graph.nodes.map(n => n.position.x + NODE_WIDTH)) - minX + 80));
  const height = Math.ceil(Math.max(...graph.nodes.map(n => n.position.y + NODE_HEIGHT)) - minY + 160);
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const edges = graph.edges.map(edge => {
    const source = nodes.get(edge.source), target = nodes.get(edge.target);
    if (!source || !target) return "";
    const [path] = getSmoothStepPath({ sourceX: source.position.x + NODE_WIDTH, sourceY: source.position.y + NODE_HEIGHT / 2,
      targetX: target.position.x, targetY: target.position.y + NODE_HEIGHT / 2, sourcePosition: Position.Right, targetPosition: Position.Left });
    const inferred = edge.style?.strokeDasharray;
    return `<path d="${path}" fill="none" stroke="${inferred ? "#b7791f" : "#94a3b8"}" stroke-width="1.3"${inferred ? ' stroke-dasharray="5 5"' : ""}/>`;
  }).join("");
  const cards = graph.nodes.map(({ id, position, data }) => {
    const n = data.device, color = colors[n.kind];
    const secondary = n.ips[0] || n.mac || (n.status === "online" ? "Online" : n.status === "offline" ? "Offline" : "Tidak diketahui");
    return `<g transform="translate(${position.x} ${position.y})"><title>${escapeXml(`${n.label} · ${secondary}`)}</title>
      <rect width="220" height="88" rx="14" fill="white" stroke="#e2e8f0"/>
      <path d="M14 0H3V88H14" fill="none" stroke="${color}" stroke-width="2" clip-path="url(#card-clip)"/>
      <rect x="14" y="29" width="30" height="30" rx="8" fill="${color}" fill-opacity=".09"/>
      <g stroke="${color}" fill="none" stroke-width="1.4"><rect x="22" y="37" width="14" height="10" rx="2"/><path d="M29 47v4m-5 0h10"/></g>
      <text x="54" y="25" font-size="9" fill="${color}" letter-spacing=".6">${escapeXml(labels[n.kind].toUpperCase() + (n.vlanId ? ` ${n.vlanId}` : ""))}</text>
      <text x="54" y="44" font-size="12" font-weight="600" fill="#0f172a">${escapeXml(shorten(n.label, 23))}</text>
      <text x="54" y="61" font-size="10" font-family="monospace" fill="#64748b">${escapeXml(shorten(secondary, 24))}</text>
      <circle cx="204" cy="23" r="3" fill="${n.status === "online" ? "#10b981" : n.status === "offline" ? "#ef4444" : "#94a3b8"}"/>
      <circle cx="0" cy="44" r="2.5" fill="${color}"/><circle cx="220" cy="44" r="2.5" fill="${color}"/>
      <desc>${escapeXml(id)}</desc></g>`;
  }).join("");
  const router = snapshot.nodes.find(n => n.kind === "router")?.label ?? "Router";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Network Map">
    <defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#dce4ec"/></pattern><clipPath id="card-clip"><rect width="220" height="88" rx="14"/></clipPath></defs>
    <rect width="100%" height="100%" fill="#f8fafc"/><rect width="100%" height="100%" fill="url(#dots)"/>
    <g font-family="Arial, sans-serif"><text x="40" y="38" fill="#0f172a" font-size="20" font-weight="700">Network Map</text>
    <text x="40" y="61" fill="#64748b" font-size="11">${escapeXml(shorten(`${router} · ${new Date(snapshot.collectedAt).toLocaleString("id-ID")} · ${scope}${snapshot.state === "partial" ? " · Data parsial" : ""}`, 100))}</text>
    <g transform="translate(${40 - minX} ${100 - minY})">${edges}${cards}</g></g></svg>`;
  return { svg, width, height };
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function exportNetworkMap(format: MapExportFormat, graph: Graph, snapshot: NetworkMapSnapshot, scope: string) {
  const { svg, width, height } = createMapSvg(graph, snapshot, scope);
  const filename = `network-map-${snapshot.connectionId}-${snapshot.collectedAt.replace(/[^\dT]/g, "-")}`;
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  if (format === "svg") { download(blob, `${filename}.svg`); return; }
  // Bound canvas dimensions and total pixel allocation for large topologies.
  const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(24_000_000 / (width * height)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Browser tidak dapat membuat gambar.");
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Gagal merender peta.")); image.src = url; });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (format === "png") {
      const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Gagal membuat PNG.")), "image/png"));
      download(png, `${filename}.png`);
    } else {
      const { jsPDF } = await import("jspdf");
      const pdfScale = Math.min(1, 14000 / Math.max(width, height));
      const pdfWidth = width * pdfScale, pdfHeight = height * pdfScale;
      const pdf = new jsPDF({ orientation: width >= height ? "landscape" : "portrait", unit: "pt", format: [pdfWidth, pdfHeight], compress: true });
      pdf.setProperties({ title: "Network Map", subject: scope });
      pdf.addImage(canvas, "PNG", 0, 0, pdfWidth, pdfHeight, undefined, "FAST");
      download(pdf.output("blob"), `${filename}.pdf`);
    }
  } finally { URL.revokeObjectURL(url); canvas.width = 0; canvas.height = 0; }
}
