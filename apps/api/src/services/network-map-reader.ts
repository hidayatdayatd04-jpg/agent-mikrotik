import { parseValueList } from "@mikrotik-tools/index";
import type { NetworkDataset } from "@shared/network-map";

// Fixed, reviewed read commands. No model/user values are interpolated into CLI.
export const NETWORK_READS = {
  identity: "/system identity print",
  resource: "/system resource print",
  interfaces: "/interface print terse without-paging",
  traffic: "/interface print stats-detail without-paging",
  bridges: "/interface bridge print terse without-paging",
  ports: "/interface bridge port print terse without-paging",
  vlans: "/interface vlan print terse without-paging",
  bridgeVlans: "/interface bridge vlan print terse without-paging",
  addresses: "/ip address print terse without-paging",
  routes: "/ip route print terse without-paging",
  dhcpServers: "/ip dhcp-server print terse without-paging",
  leases: "/ip dhcp-server lease print terse without-paging",
  arp: "/ip arp print terse without-paging",
  neighbors: "/ip neighbor print terse without-paging",
} as const;
export type DatasetName = keyof typeof NETWORK_READS;
export type NetworkRow = Record<string, string>;
export type NetworkTables = Partial<Record<DatasetName, NetworkRow[]>>;
const ROW_LIMIT = 2000;

export const NETWORK_READ_COMMAND = Object.entries(NETWORK_READS).map(([name, command]) =>
  `:put "__NM_BEGIN_${name}__"; :do { ${command} } on-error={ :put "__NM_ERROR__" }; :put "__NM_END_${name}__";`,
).join(" ");

// Whitelist fields before either graph normalization or caching. Comments and
// arbitrary properties (including secrets) cannot cross the API/AI boundary.
const FIELDS = new Set(("name version uptime cpu-load free-memory total-memory board-name architecture-name " +
  "type running disabled invalid mac-address actual-mtu mtu l2mtu rx-byte tx-byte rx-packet tx-packet " +
  "interface bridge pvid vlan-filtering vlan-id vlan-ids tagged untagged current-tagged current-untagged " +
  "address network actual-interface dst-address gateway immediate-gw gateway-status active distance routing-table routing-mark " +
  "server active-server active-address active-mac-address host-name status last-seen expires-after dynamic complete " +
  "identity platform interface-name address4 address6 vlan-encap relay").split(" "));

export function parseNetworkRows(output: string, singleton = false): NetworkRow[] {
  if (singleton) {
    const row: NetworkRow = {};
    for (const line of output.split(/\r?\n/)) {
      const m = /^\s*([\w-]+):\s*(.*?)\s*$/.exec(line);
      if (m && FIELDS.has(m[1]!)) row[m[1]!] = m[2]!.slice(0, 512);
    }
    return Object.keys(row).length ? [row] : [];
  }
  const normalized = output.replace(/^(\s*\d+)[ \t]+((?:[A-Za-z]+[ \t]+)+)(?=[\w.-]+=)/gm,
    (_match, number: string, flags: string) => `${number} ${flags.replace(/\s/g, "").toUpperCase()} `);
  return parseValueList(normalized).rows.map(row => {
    const fields: NetworkRow = { _flags: row.flags };
    for (const [key, value] of Object.entries(row.fields)) {
      if (FIELDS.has(key)) fields[key] = value.slice(0, 512);
    }
    return fields;
  }).filter(row => Object.keys(row).length > 1);
}

export function parseNetworkRead(output: string): { tables: NetworkTables; datasets: NetworkDataset[] } {
  const tables: NetworkTables = {};
  const datasets: NetworkDataset[] = [];
  for (const name of Object.keys(NETWORK_READS) as DatasetName[]) {
    const begin = `__NM_BEGIN_${name}__`;
    const end = `__NM_END_${name}__`;
    const start = output.indexOf(begin + "\r\n") >= 0 ? output.indexOf(begin + "\r\n") : output.indexOf(begin + "\n");
    const finish = start < 0 ? -1 : output.indexOf(end, start + begin.length);
    if (start < 0 || finish < 0) {
      datasets.push({ name, status: start < 0 ? "unavailable" : "truncated", rows: 0 });
      continue; // Never trust a truncated row or section.
    }
    const section = output.slice(start + begin.length, finish).trim();
    if (/(?:^|\n)\s*(?:__NM_ERROR__|failure:|bad command|syntax error|expected |error:|not enough permissions)/i.test(section)) {
      datasets.push({ name, status: "unavailable", rows: 0 });
      continue;
    }
    const rows = parseNetworkRows(section, name === "identity" || name === "resource");
    const unparsed = section.length > 0 && rows.length === 0 && !/^(Flags:|Columns:)/i.test(section);
    if (!unparsed) tables[name] = rows.slice(0, ROW_LIMIT);
    datasets.push({ name, status: unparsed ? "unavailable" : rows.length > ROW_LIMIT ? "truncated" : "ok", rows: Math.min(rows.length, ROW_LIMIT) });
  }
  return { tables, datasets };
}
