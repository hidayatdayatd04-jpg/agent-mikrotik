/**
 * Helpers for extracting live RouterOS verification details and generating
 * natural human narratives directly beneath the approval card in the same chat output.
 */

import { extractRouterOsNames } from "./verification-names";
import {
  buildVlanNarrative,
  buildInterfaceNarrative,
  buildAddressNarrative,
  buildFirewallNarrative,
  buildFallbackNarrative,
} from "./verification-narratives";

export { extractRouterOsNames, formatItemNames } from "./verification-names";

export function getVerificationToolLabel(pathOrCmd: string): string {
  const lower = pathOrCmd.toLowerCase();
  if (lower.includes("vlan")) return "Membaca interface";
  if (lower.includes("bridge")) return "Membaca interface";
  if (lower.includes("interface")) return "Membaca interface";
  if (lower.includes("address")) return "Membaca IP address";
  if (lower.includes("route")) return "Membaca route";
  if (lower.includes("pool")) return "Membaca IP Pool";
  if (lower.includes("dhcp")) return "Membaca DHCP";
  if (lower.includes("firewall")) return "Membaca firewall";
  if (lower.includes("dns")) return "Membaca DNS";
  return "Membaca interface";
}

export interface VerificationDetailsInput {
  summary: string;
  operations?: Array<{ command: string; description?: string }>;
  affectedObjects?: string[] | null;
  logs?: Array<{ command: string; output?: string | null; durationMs?: number | null }>;
  output?: string;
  durationMs?: number;
  command?: string;
  toolLabel?: string;
  narrative?: string;
}

export interface VerificationDetails {
  toolLabel: string;
  narrative: string;
  durationMs: number;
  command: string;
  output: string;
}

export function generateVerificationDetails(input: VerificationDetailsInput): VerificationDetails {
  const { summary, operations = [], affectedObjects, logs = [] } = input;

  // Find verification log or deduce command from operations
  const verifyLog = logs.find((l) => l.command.startsWith("[VERIFIKASI]"));
  let deducedCmd = "/interface/vlan print";
  if (operations.length > 0) {
    const op = operations[0]!.command.trim();
    const m = op.match(/^(\/?[a-z0-9_-]+(?:[\s/]+[a-z0-9_-]+)*)\s+(?:add|set|remove|delete|enable|disable)/i);
    if (m && m[1]) {
      const p = m[1].startsWith("/") ? m[1] : `/${m[1]}`;
      deducedCmd = `${p} print`;
    }
  }

  const command = input.command || (verifyLog ? verifyLog.command.replace("[VERIFIKASI] ", "") : deducedCmd);
  const output = input.output ?? (verifyLog ? verifyLog.output ?? "" : "");
  const durationMs = input.durationMs ?? (verifyLog?.durationMs ?? 12);

  // If narrative is already provided by server, use it
  if (input.narrative) {
    return {
      toolLabel: input.toolLabel || getVerificationToolLabel(command),
      narrative: input.narrative,
      durationMs,
      command,
      output,
    };
  }

  const toolLabel = input.toolLabel || getVerificationToolLabel(command || summary);

  const lowerSum = summary.toLowerCase();
  const isVlan =
    command.toLowerCase().includes("vlan") || lowerSum.includes("vlan") || operations.some((o) => o.command.toLowerCase().includes("vlan"));
  const isInterface = isVlan || command.toLowerCase().includes("interface") || lowerSum.includes("interface");
  const isAddress =
    command.toLowerCase().includes("address") || lowerSum.includes("ip address") || lowerSum.includes("alamat ip");
  const isFirewall =
    command.toLowerCase().includes("firewall") || lowerSum.includes("firewall") || lowerSum.includes("filter") || lowerSum.includes("nat");

  const isRemove = operations.some((o) => /remove|delete/i.test(o.command)) || /hapus|delete|remove/i.test(summary);
  const isAdd = operations.some((o) => /add|create/i.test(o.command)) || /buat|tambah|add/i.test(summary);
  const isDisable = operations.some((o) => /disable/i.test(o.command)) || /nonaktif|disable/i.test(summary);
  const isEnable = operations.some((o) => /enable/i.test(o.command)) || /aktifkan|enable/i.test(summary);

  // Extract target names
  const targets: string[] = [];
  for (const op of operations) {
    const m = op.command.match(/(?:name=|name\s*=\s*"?)([a-zA-Z0-9_.-]+)"?/i);
    if (m && m[1] && !targets.includes(m[1])) {
      targets.push(m[1]);
    }
    const addrMatch = op.command.match(/(?:address=|address\s*=\s*"?)([0-9./]+)"?/i);
    if (addrMatch && addrMatch[1] && !targets.includes(addrMatch[1])) {
      targets.push(addrMatch[1]);
    }
  }

  if (targets.length === 0) {
    if (affectedObjects && affectedObjects.length > 0) {
      for (const obj of affectedObjects) {
        const clean = obj.replace(/^\/[a-z0-9_-]+\s*/i, "").trim();
        if (clean && !targets.includes(clean)) targets.push(clean);
      }
    }
  }

  if (targets.length === 0) {
    const sumMatch = summary.match(/(?:interface|vlan|ether\d+|ip|rule)\s+([a-zA-Z0-9_./-]+)/i);
    if (sumMatch && sumMatch[1]) targets.push(sumMatch[1]);
  }

  const activeNames = extractRouterOsNames(output);
  const flags = { isRemove, isAdd, isDisable, isEnable };

  // Case 1: VLAN
  if (isVlan) {
    return { toolLabel, narrative: buildVlanNarrative(flags, targets, activeNames), durationMs, command, output };
  }

  // Case 2: General Interface
  if (isInterface) {
    return { toolLabel, narrative: buildInterfaceNarrative(flags, targets), durationMs, command, output };
  }

  // Case 3: IP Address
  if (isAddress) {
    return { toolLabel, narrative: buildAddressNarrative(targets), durationMs, command, output };
  }

  // Case 4: Firewall
  if (isFirewall) {
    return { toolLabel, narrative: buildFirewallNarrative(), durationMs, command, output };
  }

  // Fallback
  return { toolLabel, narrative: buildFallbackNarrative(summary), durationMs, command, output };
}
