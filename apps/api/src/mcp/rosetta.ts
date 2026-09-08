import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger } from "../lib/logger";
import { retryMcpRead } from "./recovery";
import { redactText } from "../lib/redaction";

/**
 * Rosetta is documentation-only: a single shared stdio process serves all
 * users. It receives NO router credentials — just the corpus DB path.
 */
export class RosettaProcess {
  private client: Client | null = null;
  private starting: Promise<Client> | null = null;

  constructor(
    private opts: {
      bunExecutable: string;
      rosettaCliPath: string;
      dbPath: string;
      logger: Logger;
      startupTimeoutMs?: number;
    },
  ) {}

  private async ensureStarted(): Promise<Client> {
    if (this.client) return this.client;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      const dbPath = resolve(this.opts.dbPath);
      if (!existsSync(dbPath)) {
        throw new Error(
          `Corpus Rosetta tidak ditemukan di ${dbPath}. Jalankan provisioning corpus terlebih dahulu.`,
        );
      }
      const transport = new StdioClientTransport({
        command: this.opts.bunExecutable,
        args: [this.opts.rosettaCliPath],
        env: { DB_PATH: dbPath, ROSETTA_OFFLINE: "1" },
        stderr: "pipe",
      });
      const stderr: string[] = [];
      transport.stderr?.on("data", (chunk: Buffer) => {
        stderr.push(chunk.toString().slice(-2000));
        if (stderr.length > 10) stderr.shift();
      });
      const client = new Client({ name: "agent-mikrotik-backend", version: "0.1.0" });
      client.onclose = () => {
        if (this.client === client) this.client = null;
      };
      const connect = client.connect(transport);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Rosetta startup timeout")),
          this.opts.startupTimeoutMs ?? 30_000,
        );
      });
      try {
        await Promise.race([connect, timeout]);
      } catch (err) {
        await client.close().catch(() => {});
        this.opts.logger.warn("rosetta startup failed", { stderrTail: redactText(stderr.join("\n")) });
        throw err;
      } finally {
        clearTimeout(timer);
      }
      this.opts.logger.info("rosetta process up", { dbPath });
      this.client = client;
      return client;
    })();

    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async listTools() {
    return retryMcpRead(() => this.loadTools());
  }

  private async loadTools() {
    const client = await this.ensureStarted();
    const tools: unknown[] = [];
    let cursor: string | undefined = undefined;
    do {
      const page = await client.listTools({ cursor });
      tools.push(...(page.tools ?? []));
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  async call(name: string, args: Record<string, unknown>) {
    return retryMcpRead(async () => {
      const client = await this.ensureStarted();
      return client.callTool({ name, arguments: args });
    });
  }

  async shutdown() {
    if (this.client) {
      await this.client.close().catch(() => {});
      this.client = null;
    }
  }
}
