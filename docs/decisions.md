# Keputusan Teknis

Log keputusan selama implementasi. Setiap entri menyebutkan alasan dan dampaknya terhadap kebutuhan pengguna (plan.md §2).

## D-001 — Bun sebagai runtime tunggal; child process di-spawn dengan executable eksplisit

**Tanggal:** 5 Sep 2026 (M0). Bun 1.4.1 terpasang via `npm i -g bun`.

**Keputusan:** Backend berjalan dengan Bun; kedua MCP di-spawn via `StdioClientTransport` dengan `command` = path executable eksplisit (Bun untuk rosetta — wajib karena `bun:sqlite`; Node/Bun untuk mikrotik-mcp — keduanya terverifikasi bekerja). `env` child dibangun minimal per proses, tidak mewarisi `process.env` aplikasi.

**Alasan:** Rosetta menolak jalan di Node; kontrol env per child adalah syarat isolasi multi-user (M4).

**Dampak:** Deployment wajib menyediakan Bun (Dockerfile base image `oven/bun`); pengguna mendapatkan spawn process yang terisolasi dan deterministik.

## D-002 — Versi dependency dipin eksak

`@usex/mikrotik-mcp@5.6.0`, `@tikoci/rosetta@0.11.1`, `@modelcontextprotocol/sdk@1.30.0` (spike awal menulis 1.26.0; lockfile menaikkannya — app memin 1.30.0). Update check anak dimatikan (`MIKROTIK_DISABLE_UPDATE_CHECK=1`). Upgrade upstream adalah keputusan eksplisit dengan diff katalog (A32), bukan otomatis.

## D-003 — Read-Only mode backend: env `MIKROTIK_READ_ONLY` pada child + dispatcher sendiri

**Keputusan:** Konektor read-only di-spawn dengan `--read-only` (atau env). Ini membuat katalog child benar-benar hanya berisi 385 tool readOnly. **Tetap**, backend mempertahankan allowlist + klasifikasi risiko sendiri (M5) — bukan sekadar mempercayai upstream — karena (a) gateway tool `invoke_tool` bisa menjalankan tool write apa pun di mode Write, (b) annotations upstream adalah hint, bukan otoritas (plan.md §4).

**Alasan:** Defense in depth: dua lapis (katalog child terfilter + dispatcher app) + audit.

**Dampak:** Skenario A07/A30/A08 ditegakkan pada dua lapis; perpindahan mode = spawn ulang child + rebuild konteks provider (M5).

## D-004 — Transaksi Safe Mode via sesi shell persisten milik MCP child

**Keputusan:** State machine transaksi (M6) memakai `SafeModeManager` bawaan mikrotik-mcp: `enable/commit/rollback/get_status`. Backend coordinator memegang keputusan lifecycle (bukan model); semua mutasi dalam satu transaksi dieksekusi melalui sesi safe mode yang sama pada child tersebut; hasil `unknown` tidak pernah dianggap sukses.

**Alasan:** Implementasi upstream terbukti menangani prompt detection, unexpected drop, dan probe commit; membangun ulang sesi SSH shell sendiri hanya menambah permukaan bug.

**Dampak:** Satu transaksi aktif per koneksi child; lock per identitas router (M6) tetap di backend agar dua connector ke router fisik yang sama terserial.

## D-005 — Layanan tanpa kredensial memakai adapter dev; tidak pernah dihitung sebagai integrasi nyata

Postgres lokal (Docker) untuk Neon di dev; MinIO untuk B2; mock deterministik untuk Brevo (OTP ke log dev), Google OIDC (dev bypass terbatas), dan Anthropic provider. Semua di belakang interface yang sama dengan production; aktif hanya saat env kredensial kosong dan `NODE_ENV=development`. Checkbox integrasi nyata di plan.md tetap kosong sampai kredensial tersedia (plan.md §1 — jangan klaim integrasi palsu).

## D-006 — Katalog tool tidak di-hardcode

`tools/list` diambil runtime dengan loop `nextCursor` (pagination upstream). Artifact `tooling/catalog/*.json` hanya untuk audit/coverage M4B, dibangun ulang saat upgrade dependency; jumlah (891/385/14) adalah bukti versi terpin, bukan konstanta aplikasi.

## D-007 — Workspace struktur & lint import

Monorepo Bun workspaces sesuai plan.md §5: `apps/web`, `apps/api`, `packages/shared`, `packages/mikrotik-tools`, `tooling/`, `docs/`. Batas import (M1): `apps/web` dan `packages/shared` dilarang mengimpor modul `apps/api` backend, ORM, supervisor, atau konfigurasi secret — ditegakkan dengan lint rule + review.
