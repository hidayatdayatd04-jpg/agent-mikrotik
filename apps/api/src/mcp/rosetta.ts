import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger } from "../lib/logger";

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
        env: { DB_PATH: dbPath },
        stderr: "pipe",
      });
      const client = new Client({ name: "agent-mikrotik-backend", version: "0.1.0" });
      const connect = client.connect(transport);
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Rosetta startup timeout")),
          this.opts.startupTimeoutMs ?? 30_000,
        ),
      );
      try {
        await Promise.race([connect, timeout]);
      } catch (err) {
        await client.close().catch(() => {});
        throw err;
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
    const client = await this.ensureStarted();
    return client.callTool({ name, arguments: args });
  }

  async shutdown() {
    if (this.client) {
      await this.client.close().catch(() => {});
      this.client = null;
    }
  }
}
