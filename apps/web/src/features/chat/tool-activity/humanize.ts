import type { PipelineStep } from "./types";

const HUMAN_TOOL_LABELS: [RegExp, string][] = [
  [/check_connection/i, "Memeriksa status koneksi"],
  [/remove_vlan_interface|delete_vlan/i, "Menghapus interface VLAN"],
  [/create_vlan_interface/i, "Membuat interface VLAN"],
  [/list_vlan_interfaces/i, "Membaca interface VLAN"],
  [/remove_bridge|delete_bridge/i, "Menghapus interface Bridge"],
  [/create_bridge/i, "Membuat interface Bridge"],
  [/list_bridges|print_bridge/i, "Membaca interface Bridge"],
  [/add_bridge_vlan/i, "Mengonfigurasi VLAN Bridge"],
  [/add_bridge_port/i, "Menghubungkan port ke Bridge"],
  [/remove_ip_pool|delete_ip_pool/i, "Menghapus IP Pool"],
  [/create_ip_pool/i, "Membuat IP Pool"],
  [/list_ip_pools/i, "Membaca IP Pool"],
  [/remove_ip_address|delete_ip/i, "Menghapus IP address"],
  [/add_ip_address/i, "Menambahkan IP address"],
  [/list_ip_addresses|print_ip_address/i, "Membaca IP address"],
  [/list_interfaces/i, "Membaca interface"],
  [/list_routes|print_ip_route/i, "Membaca route"],
  [/add_dhcp_server/i, "Menambahkan DHCP Server"],
  [/add_dhcp_network/i, "Menambahkan DHCP Network"],
  [/dhcp_client|get_dhcp_clients/i, "Membaca DHCP client"],
  [/dhcp_server/i, "Membaca DHCP server"],
  [/add_nat_rule/i, "Menambahkan aturan NAT"],
  [/firewall_nat|list_firewall_nat/i, "Membaca NAT"],
  [/add_filter_rule|add_firewall_rule/i, "Menambahkan aturan firewall"],
  [/firewall.*filter|list_firewall_rules/i, "Membaca firewall filter"],
  [/design_network_segment/i, "Mendesain segmen jaringan"],
  [/system_resource|resource/i, "Membaca resource sistem"],
  [/identity/i, "Memeriksa koneksi & identitas"],
  [/find_tools|routeros_search/i, "Mencari tool yang sesuai"],
];

export function humanizeTool(name: string): string {
  for (const [re, label] of HUMAN_TOOL_LABELS) {
    if (re.test(name)) return label;
  }
  const n = name.toLowerCase();
  if (n.startsWith("web:")) return "Deep Research";
  if (n.includes("terminal") || n.includes("exec") || n.includes("run_routeros") || n.includes("command")) {
    return "Menjalankan perintah RouterOS";
  }
  if (n.includes("verify") || n.includes("safe_mode_status")) return "Verifikasi Safe Mode";
  if (n.startsWith("docs:")) return "Mencari dokumentasi";
  const short = name.includes(":") ? name.split(":").slice(1).join(":") : name;
  return short.replace(/_/g, " ").slice(0, 48) || name;
}

/** Judul fase kerja yang manusiawi: pemeriksaan baca vs penerapan perubahan. */
export function phaseTitle(steps: PipelineStep[]): string {
  if (steps.length === 0) return "Menyiapkan pemeriksaan";
  const writeish = /set_|add_|remove_|delete_|update_|enable|disable|create_|apply|reboot|reset/i;
  const mutating = steps.some((s) => writeish.test(s.tool));
  if (mutating) return "Menerapkan perubahan";
  const allDone = steps.every((s) => s.status === "completed");
  if (allDone && steps.length > 1) return "Memeriksa konfigurasi router";
  const current = steps.find((s) => s.status === "running") ?? steps[steps.length - 1]!;
  if (steps.length === 1) return current.label;
  return "Memeriksa konfigurasi router";
}

export function formatDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)} mdtk`;
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(ms / 1000)} dtk`;
}
