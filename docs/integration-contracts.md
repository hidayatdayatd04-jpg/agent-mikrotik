# Kontrak Integrasi (M0)

Tanggal verifikasi: 5 September 2026. Semua temuan di bawah dibuktikan dengan eksekusi nyata (spike `tooling/spike/list-tools.ts`, `tooling/dump-catalog.ts`) atau pembacaan source paket terpasang — bukan asumsi dari dokumentasi. Runtime: Bun 1.4.1 di Windows (Git Bash), Node v24.13.0 tersedia sebagai fallback spawn.

## 1. `@usex/mikrotik-mcp` 5.6.0 (dipin eksak)

- **Entrypoint:** `dist/cli.js`; `bin.mikrotik-mcp` → `dist/cli.js`. Engines: `bun >= 1.3.0`.
- **Jalankan via:** `bun dist/cli.js serve` (default) dengan transport stdio. CLI subcommand lain: `tools`, `devices`, `auth-check`, `version`, `help`.
- **Env koneksi per child process:** `MIKROTIK_HOST`, `MIKROTIK_USERNAME`, `MIKROTIK_PASSWORD`, `MIKROTIK_PORT` (default 22); opsi key: `MIKROTIK_KEY_FILENAME` / `MIKROTIK_PRIVATE_KEY` / `MIKROTIK_KEY_PASSPHRASE`. Multi-device via `MIKROTIK_DEVICES` (JSON) atau `--config` file. **Semua dibaca saat `loadConfig()` di startup** — mengganti env tidak berlaku setelah proses hidup; supervisor harus spawn proses baru per koneksi (sesuai rancangan M4).
- **Read-Only:** flag `--read-only` ATAU env `MIKROTIK_READ_ONLY` (truthy: `1|true|yes|on`). Efek terverifikasi:
  - Mode normal: **891 tool** terdaftar (385 `readOnlyHint`, 163 `destructiveHint`, sisanya WRITE non-destructive; **semua 891 memiliki annotations** — tidak ada tool tanpa klasifikasi).
  - Mode read-only: **385 tool** — hanya `annotations.readOnlyHint === true`; gateway `invoke_tool`/`run_routeros_command` ikut hilang dari katalog.
  - `invoke_tool` juga menolak sendiri bila `getConfig().readOnly` dan target tool bukan readOnlyHint (defense in depth terverifikasi di source).
- **Pagination `tools/list`:** server memasang handler pagination (`nextCursor` = offset numerik string). Klien wajib loop `nextCursor` sampai habis; tanpa loop hanya halaman pertama.
- **Auth-check:** `bun dist/cli.js auth-check` menguji SSH per device; exit code `0` sukses semua, `1` ada gagal. Cocok untuk pre-save credential test dari backend (M4) tanpa membuka sesi interaktif.
- **Safe Mode (source `SafeModeManager`):** `enable_safe_mode` membuka sesi SSH shell persisten, kirim Ctrl+X, tunggu prompt; `commit_safe_mode` (Ctrl+X lagi) memverifikasi via probe; `rollback_safe_mode` menutup sesi → RouterOS auto-revert; drop tak terduga ditandai dan commit setelahnya ditolak eksplisit. Kegagalan prompt → status `unknown` dengan sesi dibiarkan terbuka. **Konsekuensi backend (M6):** seluruh mutasi dalam satu transaksi HARUS lewat sesi shell yang sama; `executeMikrotikCommand` otomatis melewatinya bila safe mode aktif. Batas RouterOS (history penuh, sesi admin lain) tetap berlaku — tidak dijanjikan rollback universal.
- **Tool generic/gateway:** `invoke_tool` (annotation WRITE — jadi otomatis hilang di read-only), `run_routeros_command` (WRITE, "last resort"), `find_tools`/`describe_tool` (meta, tidak bisa di-invoke via `invoke_tool`). Dispatcher backend tetap harus audit `invoke_tool` karena bisa menjalankan tool write apa pun saat mode Write.
- **Error koneksi:** dikembalikan sebagai `isError: true` dengan pesan terstruktur (contoh terverifikasi: `connect ECONNREFUSED 127.0.0.1:22` — membedakan unreachable vs auth). Pesan ini boleh diteruskan ke browser setelah redaction; tidak ada stack trace mentah.
- **Update check:** dimatikan via `MIKROTIK_DISABLE_UPDATE_CHECK=1` (dipakai di semua spawn production; no auto-update `latest`).
- **Schema tool:** dikirim sebagai JSON Schema di `tools/list` (bukan Zod mentah); contoh terverifikasi `add_ip_address` (required: `address`, `interface`, `disabled`, `allow_overlap`; `additionalProperties: false`).

## 2. `@tikoci/rosetta` 0.11.1 (dipin eksak)

- **Entrypoint:** `bin/rosetta.js` — **butuh runtime Bun** (`bun:sqlite`); bila di-spawn dengan Node akan berusaha mendelegasikan ke Bun. Backend harus spawn dengan executable Bun (M4).
- **Corpus DB:** resolusi `DB_PATH` env → `--db <path>` flag → default `~/.rosetta/ros-help.db` (package mode). Mapping aplikasi: `ROSETTA_DATA_DIR` → set `DB_PATH=<dir>/ros-help.db` pada child env. **Terbukti:** corpus 338.6 MB (schema v10, 363 pages, 41.967 commands) diunduh sekali via `--setup` dan persisten; refresh terkontrol via `--refresh` (tidak otomatis per pesan).
- **Katalog:** 14 tool `routeros_*` (search, get_page, lookup_property, explain_command, command_tree, search_changelogs, command_version_check, command_diff, device_lookup, search_tests, dude_search, dude_get_page, stats, current_versions). **Semua tanpa annotations** — Rosetta murni dokumentasi, tanpa akses router; dispatcher mengklasifikasikannya read-only lokal (allowlist eksplisit, bukan hint upstream).
- **Pencarian terverifikasi:** `routeros_search {"query":"bridge vlan"}` mengembalikan hasil terklasifikasi (command path `/bridge/vlan`) + halaman manual + URL sumber. Tool call rata-rata < 1s pada corpus 338 MB.
- **Tidak ada kredensial router** yang diberikan ke Rosetta (hanya `DB_PATH`).

## 3. MCP SDK TypeScript (`@modelcontextprotocol/sdk`)

- Dipakai spike: `1.26.0` (resolve ke `1.30.0` via bun.lock saat install ulang — **pin `1.30.0`** di app). StdioClientTransport dengan `env` eksplisit per child (bukan mewarisi `process.env`), `stderr: "pipe"` agar log anak tidak bocor ke stdout parent.
- Handshake + pagination loop + callTool semuanya berfungsi di Windows Bun.

## 4. Verifikasi eksternal

Provider AI nyata memerlukan API key pengguna. Mutasi Safe Mode memerlukan router lab RouterOS; tes state machine bukan pengganti bukti perangkat fisik.

## 5. Fakta lain yang mengubah asumsi plan.md

- Prompt asal menyebut "819 tool"; README saat perencanaan menyebut 885. **Realita versi 5.6.0: 891 tool** (full) / 385 (read-only). Jumlah tetap tidak di-hardcode; diambil dari `tools/list` ber-pagination saat runtime.
- `MIKROTIK_READ_ONLY` memang ada dan berfungsi (dua jalur: env dan flag CLI).
- Rosetta di npm adalah package JS dengan DB SQLite terpisah (~50 MB compressed, 338 MB terpasang) — provisioning corpus adalah langkah deployment, bukan dependensi npm.
- mikrotik-mcp juga membawa fitur opsional (dashboard HTTP, alerting, scheduler, S3) yang nonaktif pada transport stdio murni tanpa konfigurasi; tidak dipakai aplikasi.
