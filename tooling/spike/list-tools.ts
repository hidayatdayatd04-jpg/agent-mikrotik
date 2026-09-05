import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER = process.argv[2] ?? "mikrotik";
const ENV = JSON.parse(process.argv[3] ?? "{}");
const CALL = process.argv[4] ?? null;
const CALL_ARGS = JSON.parse(process.argv[5] ?? "{}");

const specs = {
  mikrotik: { cmd: process.execPath, args: [process.env.MIKROTIK_CLI_PATH] },
  rosetta: { cmd: process.execPath, args: [process.env.ROSETTA_CLI_PATH] },
};

const spec = specs[SERVER];
if (!spec) throw new Error(`unknown server: ${SERVER}`);

const childEnv = {
  ...ENV,
  NODE_ENV: "production",
  NO_UPDATE_CHECK: "1",
  DISABLE_UPDATE_CHECK: "1",
};

const transport = new StdioClientTransport(
  { command: spec.cmd, args: spec.args },
  { env: childEnv, stderr: "pipe" }
);

const stderrChunks = [];
transport.stderr?.on("data", (c) => stderrChunks.push(c.toString()));

const client = new Client({ name: "m0-spike", version: "0.0.1" });
try {
  await client.connect(transport);
  if (CALL) {
    const result = await client.callTool({ name: CALL, arguments: CALL_ARGS });
    console.log(JSON.stringify({ toolResult: result }, null, 2).slice(0, 4000));
  } else {
    const tools = [];
    let cursor = undefined;
    do {
      const page = await client.listTools({ cursor });
      tools.push(...(page.tools ?? []));
      cursor = page.nextCursor;
    } while (cursor);
    const hasAnnotations = tools.filter((t) => t.annotations).length;
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint === true).length;
    const destructive = tools.filter((t) => t.annotations?.destructiveHint === true).length;
    console.log(
      JSON.stringify(
        {
          server: SERVER,
          totalTools: tools.length,
          withAnnotations: hasAnnotations,
          readOnlyHint: readOnly,
          destructiveHint: destructive,
          noHint: tools.length - hasAnnotations,
          sampleNames: tools.slice(0, 8).map((t) => t.name),
          names: tools.map((t) => t.name),
        },
        null,
        1
      ).slice(0, 6000)
    );
  }
} finally {
  await client.close();
  if (stderrChunks.length) {
    console.log("--- child stderr (tail) ---");
    console.log(stderrChunks.join("").split("\n").slice(-5).join("\n"));
  }
}
