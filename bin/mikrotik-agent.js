#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const root = resolve(import.meta.dir, "..");
const help = `MikroTik Agent

  mikrotik-agent run [--port 3000] [--data-dir <folder>]
  mikrotik-agent --version

Web dan API: http://localhost:3000
Data default: ~/.mikrotik-agent
Ctrl+C untuk berhenti. Setup lokal otomatis pada run pertama.`;

async function main() {
  if (!args.length || args.includes("--help") || args[0] === "help") { console.log(help); return; }
  if (args[0] === "--version") { console.log(JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version); return; }
  if (args[0] !== "run") throw new Error(`Perintah tidak dikenal: ${args[0]}\n${help}`);
  let port = 3000;
  let dataDir = resolve(process.env.DATA_DIR || resolve(homedir(), ".mikrotik-agent"));
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "--port" || arg === "--data-dir") && args[i + 1] && !args[i + 1].startsWith("--")) {
      const value = args[++i];
      if (arg === "--port") {
        if (!/^\d+$/.test(value)) throw new Error("Port harus berupa integer 1–65535.");
        port = Number(value);
      } else dataDir = resolve(value);
    } else throw new Error(`Opsi tidak valid: ${arg}\n${help}`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port harus 1–65535.");
  const entry = resolve(root, "dist/api.js");
  if (!existsSync(entry) || !existsSync(resolve(root, "dist/web/index.html"))) throw new Error("Build belum tersedia. Dari source, jalankan bun install lalu bun run build.");

  // Reserve the port before touching persisted state or launching children.
  const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("Menyiapkan aplikasi…", { status: 503 }) });
  let ownsLock = false;
  const lock = resolve(dataDir, "runtime.lock");
  try {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    if (existsSync(lock)) {
      const pid = Number(readFileSync(lock, "utf8"));
      let running = Number.isInteger(pid) && pid > 0;
      if (running) { try { process.kill(pid, 0); } catch (err) { if (err.code === "ESRCH") running = false; } }
      if (running) throw new Error("Folder data sedang digunakan proses lain. Hentikan proses tersebut terlebih dahulu.");
      unlinkSync(lock);
    }
    writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
    ownsLock = true;
    const release = () => { if (ownsLock) { ownsLock = false; try { unlinkSync(lock); } catch { /* already removed */ } } };
    process.on("exit", release);

    process.env.NODE_ENV = "production";
    process.env.API_PORT = String(port);
    process.env.DATA_DIR = dataDir;
    process.env.MCP_BUN_EXECUTABLE = process.execPath;
    process.env.MIKROTIK_WEB_DIR = resolve(root, "dist/web");
    process.env.ROSETTA_DATA_DIR = resolve(dataDir, "corpus");
    const corpus = resolve(dataDir, "corpus/ros-help.db");
    mkdirSync(dirname(corpus), { recursive: true, mode: 0o700 });
    if (!existsSync(corpus)) {
      console.log("Menyiapkan dokumentasi RouterOS (unduhan pertama memerlukan internet)…");
      const require = createRequire(import.meta.url);
      const setup = Bun.spawn([process.execPath, require.resolve("@tikoci/rosetta/bin/rosetta.js"), "--refresh"], {
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DB_PATH: corpus },
        stdin: "ignore", stdout: "inherit", stderr: "inherit",
      });
      const stopSetup = () => { setup.kill(); release(); process.exit(130); };
      process.once("SIGINT", stopSetup); process.once("SIGTERM", stopSetup);
      const status = await setup.exited;
      process.off("SIGINT", stopSetup); process.off("SIGTERM", stopSetup);
      if (status !== 0) throw new Error("Unduhan dokumentasi gagal. Periksa koneksi internet lalu ulangi mikrotik-agent run.");
    }
    const { default: api } = await import(pathToFileURL(entry).href);
    server.reload({ fetch: api.fetch });
    console.log(`\nMikroTik Agent siap: http://localhost:${port}\nData lokal: ${dataDir}\nTekan Ctrl+C untuk berhenti.`);
  } catch (err) {
    server.stop(true);
    if (ownsLock) { try { unlinkSync(lock); } catch { /* best effort */ } }
    throw err;
  }
}
main().catch((err) => { console.error(err.message ?? String(err)); process.exit(1); });
