# MikroTik Agent

Chat AI untuk router MikroTik, berjalan lokal dengan Bun. Satu akun lokal dibuat otomatis (seed) dan mengakses satu workspace melalui session cookie. Web dan API berjalan bersama dalam satu proses; data tersimpan sebagai file lokal di komputer Anda.

## Fitur

- **Chat AI** dengan tool calling (read & write via Safe Mode) terhadap router MikroTik melalui SSH.
- **Connector**: register router, uji SSH sebelum kredensial disimpan (terenkripsi dengan key lokal).
- **Network Map**: peta topologi jaringan (interface, bridge, VLAN, ARP) dengan export PNG/PDF/SVG.
- **Monitoring Dashboard**: resource router, interface, dan alert ambang.
- **Backup & Diff**: snapshot `/export` ter-redaksi + diff antar backup atau live.
- **Terminal**: sesi terminal RouterOS dengan klasifikasi perintah dan safe guard.
- **Provider AI**: Gemini, OpenRouter, atau endpoint OpenAI-compatible — diatur via UI, tanpa file kredensial.
- **Rate limiter terpusat** untuk provider AI (default 4 RPM / 150.000 TPM) + fallback model + checkpoint run.
- **Safe Mode backend**: perubahan write dieksekusi dalam transaksi yang bisa di-rollback; policy dispatcher menolak tool berisiko pada mode Read-Only.

## Instalasi

Setelah paket dipublikasikan ke registry npm:

```sh
bun add -g mikrotik-agent
mikrotik-agent run
```

Buka **http://localhost:3000**. CLI membuat database SQLite, key enkripsi, dan folder lampiran otomatis pada run pertama. Dokumentasi RouterOS (corpus Rosetta, ~340 MB) diunduh sekali saat run pertama — memerlukan internet. Tidak perlu Docker, database server, atau `.env`.

**Paket belum dipublikasikan.** Sebelum publikasi, gunakan paket lokal:

```sh
bun install
bun run build
bun pm pack --ignore-scripts --filename mikrotik-agent-0.1.0.tgz
bun add -g ./mikrotik-agent-0.1.0.tgz
mikrotik-agent run
```

Atau langsung dari source setelah build: `bun run start`. Bun >= 1.3.3 harus tersedia di PATH. Instalasi global mengikuti [dokumentasi Bun](https://bun.com/docs/pm/cli/add#global).

Pada Windows, pastikan `bun.exe` tersedia di PATH; shim CLI global tidak dapat memakai wrapper PowerShell/npm saja.

## Pemakaian

Login dengan username **mikrotik-agent** (alias literal: **mikrotikagent**) dan password awal **mikrotik123**. Password default **wajib diganti setelah login pertama** melalui **Pengaturan → Keamanan & Safe Mode → Ubah password**. Akun dibuat idempotent; restart tidak mereset password.

1. Isi provider, API key, dan model melalui **Provider AI** (Gemini, OpenRouter, atau endpoint OpenAI-compatible).
2. Tambahkan router melalui **Connector**. SSH diuji sebelum kredensial disimpan.
3. Buat chat dan pilih router. Mode awal Read-Only; mode Write dijalankan lewat pengaman backend dan Safe Mode.
4. Ctrl+C menghentikan aplikasi.

Tanpa provider AI, respons memakai mock berlabel — bukan AI nyata.

## Struktur Proyek

```
apps/
  api/     — API server (Hono + Bun) : agent loop, policy dispatcher, MCP supervisor, transaksi
  web/     — Web UI (React + Vite + Tailwind + shadcn)
packages/
  mikrotik-tools/  — custom tool manifests & executor untuk RouterOS
  shared/           — skema & tipe DTO bersama (zod)
bin/mikrotik-agent.js  — CLI entrypoint produksi
tooling/
  build.ts   — bundling API + web ke dist/
  corpus/    — corpus dokumentasi RouterOS (ros-help.db, diunduh otomatis)
```

## Development

```sh
bun install        # install seluruh workspace
bun run dev        # API (3001, hot) + web (3000, proxy /api) bersamaan
bun run typecheck  # tsc -b seluruh workspace
bun run lint       # eslint
bun run build      # build web lalu bundle API ke dist/
bun run start      # jalankan CLI produksi dari source build
```

Konfigurasi opsional via `.env` (lihat `.env.example`). CLI produksi tidak membutuhkan `.env` — semua kredensial diatur melalui UI dan disimpan terenkripsi di folder data (`~/.mikrotik-agent` secara default, atau `--data-dir`).

Opsi CLI:

```
mikrotik-agent run [--port 3000] [--data-dir <folder>]
mikrotik-agent --version
```

## Arsitektur Singkat

- **Agent loop** (`apps/api/src/agent/`): memanggil provider AI, mengeksekusi tool, mem-batch event ke UI via SSE, dengan checkpoint untuk resume dan guard anti-loop.
- **Policy dispatcher** (`apps/api/src/policies/`): mengklasifikasikan tool (read/write/destructive/unknown) dan menolak yang tidak sesuai mode; katalog tool live dari child process MCP upstream (@usex/mikrotik-mcp) + Rosetta.
- **MCP supervisor** (`apps/api/src/mcp/`): mengelola child process MCP per user/connection, recycle saat wedged, dengan timeout & idle management.
- **Transaksi & Safe Mode** (`apps/api/src/transactions/`): perubahan write dibungkus safe-mode RouterOS; commit/rollback tervalidasi state machine; failure injection membuat state `unknown` yang harus direkonsiliasi, tidak pernah diklaim sukses.
- **DB**: SQLite via Drizzle ORM (`agent.sqlite` di folder data), schema & migrasi idempotent.

## Lisensi

Properti dari pemilik repositori. Tidak untuk distribusi tanpa izin.
