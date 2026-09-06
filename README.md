# MikroTik AI Agent

Chatbot full-stack untuk mengelola router MikroTik lewat AI dengan pengaman berlapis: **Read-Only default**, transaksi **Safe Mode** dengan commit/rollback, audit lengkap, dan kredensial terenkripsi. Agen tidak pernah mengeksekusi mutasi router di luar transaksi yang diawasi backend.

## Stack

- **Runtime:** Bun (monorepo workspaces)
- **Frontend:** React 19 + TypeScript + Vite + Tailwind 4 + shadcn/ui
- **Backend:** Hono + Zod + Drizzle ORM (PostgreSQL/Neon)
- **MCP:** `@usex/mikrotik-mcp` (eksekusi router, child process per user) + `@tikoci/rosetta` (dokumentasi RouterOS, runtime Bun)
- **Storage:** Backblaze B2 (native API, bucket privat) — upload/download di-proxy backend
- **Email:** Brevo SMTP (OTP login)
- **Provider AI (pilihan user):** Google Gemini, OpenRouter, atau Custom OpenAI-compatible — dengan auto-fetch daftar model. Tanpa Anthropic.

## Arsitektur singkat

```
Browser ── /api (Hono :3001, session cookie HttpOnly)
  ├─ Auth: email OTP 6 digit (Brevo SMTP) + Google OIDC (opsional)
  ├─ Connectors: probe SSH → persist (password AES-256-GCM, AAD user+connection)
  ├─ Chat SSE: run agent loop → provider AI (per-user settings, key disegel)
  │    └─ tool call → PolicyDispatcher (read-only/write, per mode) →
  │         child process MCP (per user+connector) → router SSH
  │         mutasi write wajib dalam transaksi Safe Mode (state machine backend)
  └─ Attachments: B2 privat via backend proxy (ownership per-request)
```

Prinsip: keputusan keamanan (mode, ownership, transaksi, rate limit) **selalu di server**, tidak pernah percaya model. Katalog tool yang dikirim ke provider difilter per mode — mode Read-Only tidak mengirim definisi tool mutasi sama sekali (terukur: 342 tool read-only, 0 mutasi).

## Menjalankan di development

Prasyarat: [Bun](https://bun.sh) 1.4+, Docker (untuk Postgres/MinIO lokal), Node tidak wajib.

```bash
# 1. Clone & install
bun install

# 2. Database lokal (Postgres 17 + MinIO)
docker compose up -d postgres minio

# 3. Konfigurasi
cp .env.example .env   # isi nilai nyata bila ada (Neon/B2/Brevo/Google)

# 4. Migrasi database dev
bun run db:migrate

# 5. Jalan (API :3001 + Web :3000, satu terminal)
bun run dev
```

Buka http://localhost:3000 → login dengan email (OTP dicetak ke log API saat Brevo belum dikonfigurasi) → buka **Provider AI** untuk mengisi Gemini/OpenRouter/Custom (API key disegel, tidak pernah dibaca balik) → tambahkan router di **Connector** (mulai Read-Only) → chat.

Dokumen lanjutan: [docs/setup.md](docs/setup.md) · [docs/security.md](docs/security.md) · [docs/recovery.md](docs/recovery.md) · [docs/decisions.md](docs/decisions.md) · [docs/integration-contracts.md](docs/integration-contracts.md) · [docs/tool-coverage.md](docs/tool-coverage.md)

## Perintah verifikasi

```bash
bun run build        # build web + api
bun run typecheck    # tsc project references (semua workspace)
bun run lint         # eslint
bun test apps/api    # 104 test API (butuh Postgres lokal jalan)
bun run test:ui      # 8 test web (vitest)
```

## Status integrasi nyata vs mock (jujur)

| Layanan | Status | Catatan |
| --- | --- | --- |
| Postgres (Docker lokal) | **Nyata** | Migrasi & seluruh test integrasi |
| Neon PostgreSQL | **Nyata** | Migrasi via neon-http terbukti (14 tabel); pg Pool ke pooler ter-reset dari host ini → app dev pakai Postgres lokal |
| Backblaze B2 | **Nyata** | Native B2 API (bukan S3 SDK — lihat docs/decisions.md D-012); upload/download/delete ke bucket produksi teruji E2E |
| Brevo SMTP | **Nyata** | AUTH TLS + sendMail 250 queued terbukti; **BREVO_SENDER_EMAIL belum diisi user** → OTP dev masih ke log |
| Brevo REST API | **Blocker** | IP 159.26.119.220 belum di-whitelist user di dashboard Brevo |
| Google OIDC | **Implementasi, belum teruji** | Menunggu GOOGLE_CLIENT_ID/SECRET user |
| Gemini / OpenRouter | **Belum teruji nyata** | Menunggu API key user; bukti via fake provider lokal OpenAI-compatible (protokol sama) |
| MCP mikrotik-mcp / rosetta | **Nyata** | tools/list 891/14 tool, child process per user, respawn & idle cleanup teruji |
| Router fisik (lab) | **Tidak tersedia** | Probe SSH & alur connector terbukti via container SSH lab (D-013); mutasi Safe Mode nyata menunggu router lab — **gap-open** |

Detail bukti per skenario penerimaan (A01–A35): tabel §10 `plan.md`. Log progres implementasi: §12 `plan.md`.

## Keamanan (ringkas)

- Read-Only default; perpindahan mode compare-and-set (POLICY_CHANGED race-safe)
- Password router & API key provider: AES-256-GCM, nonce unik, AAD anti-pindah record
- Session opaque, hash di DB, cookie HttpOnly; OTP keyed digest, atomic consume
- Semua query ownership by userId session; attachment tidak ada presigned URL
- Rate limit 20 run/menit/user; upload 4×10MiB, sniffing konten (ekstensi berbahaya ditolak)
- Output tool & prompt dibersihkan (redaction) sebelum ke provider/log/browser
- Prompt injection: enforcement di dispatcher server-side — model tidak bisa melewati (teruji E2E §10 A18)

Lengkap: [docs/security.md](docs/security.md)

## Batasan yang diketahui (jujur)

- Mutasi Safe Mode ke router nyata belum terbukti (butuh router lab) — state machine & failure injection lulus 12+20 test
- Uji fisik mobile/keyboard/screen-reader belum (tanpa browser automation) — build responsif & aria-label ada
- Rate limit in-process (single-node) — Redis TODO untuk multi-node (D-014)
- Sweep orphan B2 berjadwal belum (D-015)
- Pagination riwayat percakapan belum (volume dev kecil)
- Preview gambar inline di chat belum (chip nama/ukuran saja)
