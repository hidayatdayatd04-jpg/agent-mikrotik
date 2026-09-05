import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "catalog");
mkdirSync(OUT_DIR, { recursive: true });
const MIKROTIK_CLI = resolve(HERE, "spike", "node_modules", "@usex", "mikrotik-mcp", "dist", "cli.js");
const ROSETTA_CLI = resolve(HERE, "spike", "node_modules", "@tikoci", "rosetta", "bin", "rosetta.js");

async function dumpCatalog(server, spec, extraEnv, outFile) {
  const transport = new StdioClientTransport(spec, { env: extraEnv, stderr: "pipe" });
  const client = new Client({ name: "catalog-dump", version: "0.0.1" });
  await client.connect(transport);
  const tools = [];
  let cursor = undefined;
  do {
    const page = await client.listTools({ cursor });
    tools.push(...(page.tools ?? []));
    cursor = page.nextCursor;
  } while (cursor);
  writeFileSync(resolve(OUT_DIR, outFile), JSON.stringify({ server, capturedAt: new Date().toISOString(), toolCount: tools.length, tools }, null, 1));
  console.log(`${server}: ${tools.length} tools -> ${outFile}`);
  await client.close();
}

await dumpCatalog(
  "mikrotik",
  { command: process.execPath, args: [MIKROTIK_CLI] },
  { MIKROTIK_DISABLE_UPDATE_CHECK: "1" },
  "mikrotik-full.json"
);

await dumpCatalog(
  "mikrotik-readonly",
  { command: process.execPath, args: [MIKROTIK_CLI, "--read-only"] },
  {},
  "mikrotik-readonly.json"
);

await dumpCatalog(
  "rosetta",
  { command: process.execPath, args: [ROSETTA_CLI] },
  { DB_PATH: resolve(HERE, "corpus", "ros-help.db") },
  "rosetta.json"
);
