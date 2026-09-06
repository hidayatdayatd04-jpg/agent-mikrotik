# Setup & Menjalankan

Panduan operasional dari checkout bersih sampai aplikasi berjalan. Untuk arsitektur dan keamanan, lihat [security.md](security.md); untuk keputusan teknis, lihat [decisions.md](decisions.md).

## Prasyarat

- **Bun ≥ 1.4** — runtime tunggal (API, MCP rosetta child, test). Instal: `powershell -c "irm bun.sh/install.ps1 | iex"` (Windows) atau `curl -fsSL https://bun.sh/install | bash`.
- **Docker Desktop** — Postgres 17 & MinIO untuk development lokal.
- Router MikroTik dengan SSH aktif (untuk fungsionalitas penuh; tanpa router, chat dokumentasi tetap berfungsi).

## Langkah demi langkah

### 1. Install dependency

```bash
bun install
```

Workspaces: `apps/web`, `apps/api`, `packages/shared`, `packages/mikrotik-tools`, `tooling/`.

### 2. Jalankan service lokal

```bash
docker compose up -d postgres minio
```

- Postgres: `localhost:5432`, user `dev`, password `dev`, db `agent_mikrotik`.
- MinIO: `http://localhost:9000` (konsol `:9001`), user `minioadmin`/`minioadmin123` — hanya dipakai bila `B2_ENDPOINT` diarah ke MinIO.

### 3. Konfigurasi environment

```bash
cp .env.example .env
```

Minimal untuk dev:
- Biarkan kredensial eksternal (Google/Brevo/B2) kosong → mode dev aktif: OTP dicetak ke log API, storage memakai adapter lokal/mock, Google OIDC dilewati.
- `DATABASE_URL=postgres://dev:dev@localhost:5432/agent_mikrotik`
- `ROUTER_CREDENTIAL_KEY` — **wajib** 32-byte base64 untuk menyegel password router. Generate: `bun -e "console.log(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))"`.
- `ROSETTA_DATA_DIR` — corpus dokumentasi (default `tooling/corpus`).

Bila kredensial nyata tersedia (Neon/B2/Brevo SMTP), isi sesuai komentar di `.env.example`. Nilai nyata tidak pernah di-commit.

### 4. Migrasi database

```bash
bun run db:migrate          # Postgres lokal (DATABASE_URL)
# Neon produksi:
DATABASE_URL=... bun run --cwd apps/api db:migrate-neon   # jalur neon-http
```

Jurnal migrasi ada di tabel `__drizzle_migrations`. Gagal migrasi: schema transaksional drizzle — batch gagal tidak apply parsial; lihat [recovery.md](recovery.md).

### 5. Jalan

```bash
bun run dev       # API :3001 (HMR) + Web :3000 (Vite proxy /api → :3001)
```

Login → **Provider AI** (isi Gemini/OpenRouter/Custom; key disegel AES-GCM, auto-fetch model) → **Connector** (tambah router; mulai Read-Only) → chat.

## Verifikasi otomatis

```bash
bun run build       # build web (tsc+vite) + api (bun bundle)
bun run typecheck   # tsc -b project references
bun run lint        # eslint semua workspace
bun test apps/api   # 104 test; butuh Postgres lokal jalan
bun run test:ui     # 8 test web (vitest, scoped apps/web)
```

Semua hijau dari checkout bersih sebelum setiap commit milestone (lihat plan.md §12 log).

## Variabel environment penting

| Variabel | Wajib? | Keterangan |
| --- | --- | --- |
| `DATABASE_URL` | ya | Postgres app (pooled Neon di production) |
| `ROUTER_CREDENTIAL_KEY` | ya | 32-byte base64 AES key untuk seal kredensial router & provider |
| `TRUSTED_ORIGINS` | ya | Origin yang diizinkan (CSRF/cookie) |
| `ROSETTA_DATA_DIR` | ya | Corpus dokumentasi Rosetta |
| `ROUTER_ALLOWED_CIDRS` | ya | Subnet target router yang diizinkan (loopback/metadata selalu ditolak) |
| `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` | tidak | Google OIDC (bila kosong, alur OTP saja) |
| `BREVO_SMTP_*` | tidak | SMTP OTP produksi (bila kosong, OTP ke log dev) |
| `BREVO_SENDER_EMAIL` | produksi ya | Sender terverifikasi Brevo — tanpa ini Brevo menolak kirim |
| `B2_KEY_ID/B2_APPLICATION_KEY/B2_BUCKET` | tidak | B2 nyata (native API); kosong → adapter lokal |
| `AI_PROVIDER_KIND/BASE_URL/MODEL/API_KEY` | tidak | Default server; user menimpa per-akun via UI Provider AI |
| `AGENT_MAX_STEPS/AGENT_MAX_TOOL_CALLS/AGENT_RUN_TIMEOUT_MS` | tuning | Batas agent loop |
| `MAX_ACTIONS_PER_TRANSACTION` | tuning | Cap aksi RouterOS per transaksi Safe Mode |

## Deployment (ringkas)

- Dockerfile backend: base `oven/bun`, dependency dipin (`bun.lock`), user non-root, health check `/api/health`, graceful shutdown (SIGTERM → stop supervisor child).
- Reverse proxy: serve `apps/web/dist` static + proxy `/api` → API (single origin, cookie SameSite jalan).
- Wajib: HTTPS, `Secure` cookie, `TRUSTED_ORIGINS` produksi, sender Brevo terverifikasi, rotasi secret yang pernah muncul di chat prompt (lihat security.md §secret-replacement).
- Jaringan: backend harus bisa merute ke LAN router (VPN/ dalam VPC). API publik bukan SSH proxy — hanya user login dengan connector miliknya.
