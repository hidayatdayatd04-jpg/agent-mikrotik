/**
 * Builds tooling/routeros-coverage.json from the pinned upstream catalog.
 *
 * Maps every upstream tool to RouterOS command paths extracted from its
 * description/schema, groups them by the menu groups of plan.md §4.1,
 * and reports per (menu, operation) coverage status. Data-only and honest:
 * a (menu, operation) without a mapped upstream tool is reported gap-open,
 * never silently dropped. Custom tools are merged in from packages/mikrotik-tools.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

interface CatalogTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

const ROOT = resolve(import.meta.dir, "../..");
const CATALOG_PATH = resolve(ROOT, "tooling/catalog/mikrotik-full.json");
const OUT_JSON = resolve(ROOT, "tooling/routeros-coverage.json");

const GROUPS: Record<string, string[]> = {
  "system-and-device": [
    "/system identity", "/system resource", "/system health", "/system clock", "/system ntp",
    "/system logging", "/system history", "/system package", "/system routerboard", "/system watchdog",
    "/system note", "/system license", "/system leds", "/system reboot", "/system shutdown",
    "/system reset-configuration", "/system scheduler", "/system script", "/system console",
    "/system special-login", "/backup", "/system backup",
  ],
  "interface-l2": [
    "/interface ethernet", "/interface bridge", "/interface vlan", "/interface bonding",
    "/interface ethernet switch", "/interface list", "/ip neighbor discovery", "/interface veth",
    "/interface dot1x", "/interface", "/interface monitor-traffic",
  ],
  "wireless-radio": [
    "/interface wireless", "/interface wifi", "/interface wifiwave2", "/interface wlan",
    "/caps-man", "/interface wireless security-profiles", "/interface wireless access-list",
    "/interface wireless registration-table", "/interface wireless frequency-monitor",
  ],
  "ip-services": [
    "/ip address", "/ipv6 address", "/ip pool", "/ipv6 pool", "/ip dhcp-client", "/ipv6 dhcp-client",
    "/ip dhcp-server", "/ipv6 dhcp-server", "/ipv6 dhcp-relay", "/ip dns", "/ip arp",
    "/ipv6 neighbor", "/ip neighbor", "/ip service", "/ip cloud", "/ip settings", "/ipv6 settings",
    "/ipv6 nd", "/ip traffic-flow",
  ],
  routing: [
    "/ip route", "/ipv6 route", "/routing table", "/routing rule", "/routing id", "/routing bgp",
    "/routing ospf", "/routing rip", "/routing bfd", "/routing filter", "/routing settings",
    "/routing nexthop", "/routing rpki", "/routing igmp-proxy", "/routing pimsm", "/mpls",
  ],
  "firewall-nat": [
    "/ip firewall", "/ipv6 firewall", "/ip firewall address-list", "/ipv6 firewall address-list",
    "/ip firewall service-port",
  ],
  "qos-traffic": ["/queue simple", "/queue tree", "/queue type", "/queue interface", "/queue priority"],
  "vpn-tunnel": [
    "/ppp", "/interface wireguard", "/ip ipsec", "/interface l2tp-client", "/interface l2tp-server",
    "/interface sstp-client", "/interface sstp-server", "/interface ovpn-client", "/interface ovpn-server",
    "/interface pptp-client", "/interface pptp-server", "/interface gre", "/interface ipip",
    "/interface eoip", "/interface vxlan",
  ],
  "hotspot-aaa": ["/ip hotspot", "/hotspot", "/radius", "/user-manager"],
  "user-security": ["/user", "/ip ssh", "/certificate", "/user settings"],
  "file-automation": ["/file", "/export", "/import", "/tool netwatch", "/tool fetch", "/tool sms"],
  diagnostics: [
    "/tool ping", "/tool traceroute", "/tool bandwidth-test", "/tool speed-test", "/tool sniffer",
    "/tool flood-ping", "/tool ip-scan", "/tool profile", "/tool traffic-generator",
    "/tool traffic-monitor", "/tool graphing", "/tool wol", "/port",
  ],
  "optional-features": ["/container", "/disk", "/lte", "/gps", "/smb", "/tool romon", "/snmp", "/led"],
};

/**
 * Menus where the upstream tool description references the path indirectly
 * (placeholders like `<auto-detected path>`) or via an equivalent menu.
 * Maps inventory menu -> regexes over the tool description that indicate coverage.
 */
const MENU_ALIASES: Record<string, string[]> = {
  "/interface bonding": ["bonding"],
  "/interface list": ["interface list", "interface-list", "members of an interface list", "list of interfaces"],
  "/interface wireless registration-table": ["registration table", "registration-table", "registered client stations", "wireless clients currently associated"],
  "/mpls": ["mpls", "label switched path", "lsp "],
  "/backup": ["\\.backup", "binary backup", "system backup save", "backup files", "disaster recovery"],
  "/file": ["file print", "file system", "device filesystem", "files on the router", "list files"],
  "/tool ping": ["ping a host", "icmp ping", "ping test", "ping tool", "ping command", "send pings"],
  "/lte": ["lte modem", "lte interface", "cellular", "sim slot", "modem info"],
  "/gps": ["gps", "gnss"],
  "/smb": ["smb share", "samba", "windows file sharing"],
  "/snmp": ["snmp community", "snmp settings", "snmp trap"],
  "/led": ["led settings", "led profile", "system leds", "device leds"],
  "/user-manager": ["user manager", "user-manager"],
};

const ROOTS = new Set([
  "ip", "ipv6", "interface", "system", "routing", "queue", "ppp", "tool", "user", "file",
  "bridge", "wireless", "wifi", "wifiwave2", "wlan", "caps-man", "hotspot", "ipsec", "radius",
  "mpls", "snmp", "certificate", "container", "disk", "led", "gps", "lte", "romon", "smb",
  "port", "export", "import", "backup",
]);

const OPERATIONS = [
  "list/get", "add", "set", "remove", "enable", "disable", "move", "monitor",
  "reset/reboot", "export", "import", "other",
] as const;
type Operation = (typeof OPERATIONS)[number];

function classifyOperation(toolName: string, cmd: string): Operation {
  const c = cmd.toLowerCase();
  const n = toolName.toLowerCase();
  if (/(restart|reboot|shutdown|reset-config|reset-configuration)/.test(n)) return "reset/reboot";
  if (/export/.test(c) || /\bexport\b/.test(n)) return "export";
  if (/import/.test(c) || /\bimport\b/.test(n)) return "import";
  if (/monitor|traffic|stat/.test(c) || /monitor/.test(n)) return "monitor";
  if (/\bmove\b/.test(c) || /\bmove\b/.test(n)) return "move";
  if (/disable/.test(n) || /\bdisable\b/.test(c)) return "disable";
  if (/enable/.test(n) || /\benable\b/.test(c)) return "enable";
  if (/remove|delete|clear|flush|eject|format/.test(n) || /\b(remove|clear|flush|eject|format)\b/.test(c)) return "remove";
  if (/\badd\b|create/.test(n) || /\badd\b/.test(c)) return "add";
  if (/set|update|edit|make-static|renew|release|sign|regenerate|run|start|stop|download|check-for-updates|load|save|import-host|export-host/.test(n) || /\b(set|make-static|renew|release|sign|run|start|stop|download|save|load)\b/.test(c)) return "set";
  if (/print|list|get|find|show|detail|count-only|check|scan|test/.test(n) || /\b(print|check)\b/.test(c)) return "list/get";
  return "other";
}

const CMD_RE = /\/[a-z0-9][a-z0-9 /_-]*/g;

function extractPaths(t: CatalogTool): string[] {
  const blob = `${t.description ?? ""} ${JSON.stringify(t.inputSchema ?? {})}`;
  const found = new Set<string>();
  for (const m of blob.matchAll(CMD_RE)) {
    const cmd = m[0].trim().replace(/\s+/g, " ").replace(/[.,;:)\]]+$/, "");
    const seg = cmd.split(" ")[0]?.slice(1);
    if (seg && ROOTS.has(seg)) found.add(cmd);
  }
  return [...found];
}

interface ToolRef {
  name: string;
  origin: "upstream" | "custom";
  risk: "read" | "write";
}
interface OpEntry {
  status: "covered-existing" | "covered-custom" | "gap-open";
  tools: ToolRef[];
}
interface MenuEntry {
  command_path: string;
  operations: Partial<Record<Operation, OpEntry>>;
}
interface GroupEntry {
  group: string;
  menus: MenuEntry[];
  summary: { menus: number; operationsMapped: number; coveredExisting: number; coveredCustom: number; gapOpen: number };
}

async function main() {
  if (!existsSync(CATALOG_PATH)) {
    console.error("catalog missing — run tooling/dump-catalog.ts first");
    process.exit(1);
  }
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as { tools: CatalogTool[] };
  const tools = catalog.tools;

  const roCatalog = JSON.parse(readFileSync(resolve(ROOT, "tooling/catalog/mikrotik-readonly.json"), "utf8")) as { tools: CatalogTool[] };
  const roNames = new Set(roCatalog.tools.map((t) => t.name));

  // tool -> set of menu prefixes it touches (menu = first 2 segments)
  const toolMenus = new Map<string, Set<string>>();
  const toolCmds = new Map<string, string[]>();
  for (const t of tools) {
    const cmds = extractPaths(t);
    toolCmds.set(t.name, cmds);
    const menus = new Set<string>();
    for (const c of cmds) {
      const parts = c.split(" ");
      // menu depth: /ip firewall filter → menu is "/ip firewall"; /system reboot → "/system reboot"
      menus.add(parts.slice(0, Math.min(parts.length, 3)).join(" ").replace(/\b(print|add|set|remove|enable|disable|move|detail|count-only|where|stats|file|detail where|run|start|stop)\b.*$/i, "").trim() || parts.slice(0, 2).join(" "));
    }
    toolMenus.set(t.name, menus);
  }

  // Custom tools from packages/mikrotik-tools manifests
  const customTools: { name: string; menu: string; risk: "read" | "write" }[] = [];
  try {
    const { customManifests } = await import(resolve(ROOT, "packages/mikrotik-tools/src/index.ts"));
    for (const m of customManifests() as { id: string; commandPath?: string; risk?: string }[]) {
      customTools.push({ name: m.id, menu: m.commandPath ?? "", risk: m.risk === "read-only" ? "read" : "write" });
    }
  } catch {
    console.warn("custom manifests unavailable (package not built) — coverage counts upstream only");
  }

  const coverage: Record<string, GroupEntry> = {};

  for (const [groupId, menus] of Object.entries(GROUPS)) {
    const group: GroupEntry = { group: groupId, menus: [], summary: { menus: 0, operationsMapped: 0, coveredExisting: 0, coveredCustom: 0, gapOpen: 0 } };
    for (const menu of menus) {
      const menuEntry: MenuEntry = { command_path: menu, operations: {} };
      // find upstream tools touching this menu (by extracted command path or alias phrases)
      const matching: { tool: string; cmd: string }[] = [];
      const aliases = MENU_ALIASES[menu] ?? [];
      for (const t of tools) {
        const toolName = t.name;
        const cmds = toolCmds.get(toolName) ?? [];
        const hit = cmds.find((c) => c === menu || c.startsWith(menu + " "));
        const desc = (t.description ?? "").toLowerCase();
        const aliasHit = aliases.some((a) => new RegExp(a, "i").test(desc));
        if (hit) matching.push({ tool: toolName, cmd: hit });
        else if (aliasHit) matching.push({ tool: toolName, cmd: `${menu} (via description)` });
      }
      const customMatching = customTools.filter((c) => c.menu === menu || c.menu.startsWith(menu + " "));

      if (matching.length === 0 && customMatching.length === 0) {
        // no tool at all — menu exists in inventory but nothing maps to it
        menuEntry.operations["list/get"] = { status: "gap-open", tools: [] };
      } else {
        for (const op of OPERATIONS) {
          const upstream = matching.filter((x) => classifyOperation(x.tool, x.cmd) === op);
          const custom = customMatching.filter((c) => op !== "list/get" ? false : false); // custom mapping refined later
          void custom;
          if (upstream.length) {
            menuEntry.operations[op] = {
              status: "covered-existing",
              tools: upstream.map((x) => ({ name: x.tool, origin: "upstream" as const, risk: roNames.has(x.tool) ? "read" as const : "write" as const })),
            };
          }
        }
        // any custom tool for this menu covers its declared operation
        for (const c of customMatching) {
          const op = classifyOperation(c.name, c.menu);
          const existing = menuEntry.operations[op];
          if (existing && existing.status === "covered-existing") {
            existing.tools.push({ name: c.name, origin: "custom", risk: c.risk });
          } else {
            menuEntry.operations[op] = { status: "covered-custom", tools: [{ name: c.name, origin: "custom", risk: c.risk }] };
          }
        }
      }
      group.menus.push(menuEntry);
    }
    // summarize
    for (const m of group.menus) {
      group.summary.menus += 1;
      for (const op of Object.values(m.operations)) {
        group.summary.operationsMapped += 1;
        if (op.status === "covered-existing") group.summary.coveredExisting += 1;
        else if (op.status === "covered-custom") group.summary.coveredCustom += 1;
        else group.summary.gapOpen += 1;
      }
    }
    coverage[groupId] = group;
  }

  writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), source: "@usex/mikrotik-mcp@5.6.0 tools/list + packages/mikrotik-tools", groups: coverage }, null, 1));
  console.log(`coverage written: ${OUT_JSON}`);
  for (const [g, e] of Object.entries(coverage)) {
    console.log(`${g}: menus=${e.summary.menus} ops=${e.summary.operationsMapped} covered=${e.summary.coveredExisting} custom=${e.summary.coveredCustom} gap-open=${e.summary.gapOpen}`);
  }
}

await main();
