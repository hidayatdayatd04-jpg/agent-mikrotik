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

## D-008 — Tool tambahan diekspos backend, bukan fork MCP upstream

**Keputusan:** Gap inventaris §4.1 (bonding, neighbor discovery, MPLS, LTE, GPS, SMB, SNMP — semuanya operasi read-only) ditutup dengan tool custom di `packages/mikrotik-tools` (namespace `custom_*`), diekspos oleh backend ke katalog agent — BUKAN dengan fork `@usex/mikrotik-mcp`.

**Alasan:** Semua gap adalah operasi `list/get`; `invoke_tool` upstream tetap menjadi jalur untuk tool upstream. Fork menambah beban pemeliharaan (patch, rebuild, upgrade) tanpa keuntungan karena tidak ada perilaku upstream yang perlu diubah. Sebaliknya, tool custom memakai `RouterOsExecutor` yang di-inject backend (sesi SSH milik connector; M6 mengarahkan executor ke sesi Safe Mode saat transaksi) sehingga jalur eksekusi, policy, audit, dan rate-limit tunggal terjamin.

**Dampak:** Katalog gabungan = upstream (dari `tools/list` runtime) + `custom_*` (manifest statis). Bila upstream kelak menambah tool serupa, migrasi lewat uji kesetaraan di dispatcher, bukan routing otomatis.

## D-009 — Coverage dihitung per operasi (menu × operasi), bukan per tool

**Keputusan:** `tooling/routeros-coverage.json` memetakan cakupan per (menu, operasi) — list/get, add, set, remove, enable, disable, move, monitor, reset/reboot, export, import — diekstraksi dari command path di deskripsi/schema katalog upstream plus alias deskripsi untuk tool yang path-nya tidak literal (mis. `get_wireless_registration_table` memakai placeholder `<auto-detected path>`).

**Alasan:** Nama tool serupa tidak membuktikan operasi tercakup (plan.md §4.1); pengukuran per operasi memberi denominator jujur. Menu tanpa tool upstream ditandai gap-open sampai tool custom menutupnya; menu yang memang tidak ada di router target diklasifikasi `unsupported-on-target` saat runtime via capability check (`TOOL_UNSUPPORTED`), bukan dihapus dari denominator.

**Dampak:** Snapshot M4B: 489 operasi, 482 covered-existing, 7 covered-custom, 0 gap-open. Mutasi nyata ke router tetap `gap-open` secara bukti-lab sampai router fisik tersedia (kejujuran pengujian, bukan keberadaan tool).
