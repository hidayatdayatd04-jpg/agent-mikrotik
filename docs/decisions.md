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

## D-010 — Kredensial layanan nyata terpasang di `.env`; hasil verifikasi dicatat per layanan

**Tanggal:** 5 Sep 2026 (M6). User memberikan kredensial Neon, Backblaze B2, dan Brevo; semua dipasang di `.env` (ter-gitignore) dan diverifikasi dengan probe nyata sebelum dicatat.

**Hasil verifikasi:**

- **Neon** (pooler `ep-square-violet-az3qiw3f-pooler.c-3.ap-southeast-1`): driver `pg` Pool ter-reset (ECONNRESET) dari host Windows ini, tetapi driver `@neondatabase/serverless` neon-http bekerja. Migrasi dijalankan nyata via `apps/api/scripts/migrate-neon.ts` → 14 tabel + journal `__drizzle_migrations` terbentuk di `neondb`. Skrip migrasi Neon memakai neon-http; Postgres lokal Docker tetap default dev/test harian.
- **Backblaze B2**: Master Application Key (`b7b05c52b0a4`) valid — `b2_authorize_account` OK (`apiUrl https://api004.backblazeb2.com`, S3 `s3.us-west-004.backblazeb2.com`). Bucket `mikrotik-agent` terverifikasi ada via `b2_list_buckets` (tipe `allPrivate`, id `bb37ebf0b56c7502ab000a14`). Kedua key non-master `mikrotik-key` (keyID `004b7b05c52b0a40000000005`) GAGAL 401 — application key non-master hanya tampil sekali saat pembuatan; nilai yang user salin kelihatannya adalah application key Master. Dipakai: Master key + bucket `mikrotik-agent`, endpoint S3 `https://s3.us-west-004.backblazeb2.com`.
- **Brevo**: REST API key ditolak — "unrecognised IP address 159.26.119.220 … add the new IP address in this link: https://app.brevo.com/security/authorised_ips" (blokir IP eksternal; perlu user menambahkan IP ke authorised IPs di dashboard Brevo). **SMTP key VALID dan diverifikasi end-to-end**: percakapan SMTP nyata ke `smtp-relay.brevo.com:587` (STARTTLS, TLS 1.3) → AUTH LOGIN sukses (235), lalu `sendMail` nyata via nodemailer diterima (250 queued). OTP email produksi memakai jalur SMTP (adapter `BrevoSmtpSender`); BREVO_SENDER_EMAIL belum diisi user (sender terverifikasi Brevo belum tersedia) sehingga mode dev masih memakai mock OTP ke log.

**Keputusan:** Jalur yang terbukti bekerja (neon-http untuk Neon, SMTP untuk Brevo, Master key S3-compatible untuk B2) menjadi jalur production; yang terblokir (Brevo REST API) didokumentasikan sebagai blocker eksternal, tidak di-klaim aktif. `.env` tidak pernah di-commit (gitignore); template `.env.example` tetap placeholder.

**Dampak:** Checkbox integrasi nyata di plan.md untuk Neon/B2/Brevo-SMTP dicentang dengan bukti di atas; Brevo REST API tetap blocker eksternal sampai user men-whitelist IP 159.26.119.220.

## D-011 — Provider AI multi-provider OpenAI-compatible (Gemini/OpenRouter/Custom); Anthropic dikeluarkan

**Tanggal:** 5 Sep 2026 (M7, revisi permintaan user). User menolak Anthropic/Claude karena biaya; provider AI menjadi pilihan user: Google Gemini (endpoint OpenAI-compat resmi `https://generativelanguage.googleapis.com/v1beta/openai/v1`), OpenRouter (`https://openrouter.ai/api/v1`), atau Custom (apiKey + baseUrl + model manual). `@anthropic-ai/sdk` di-uninstall; satu SDK `openai` v4 dengan baseURL injectable melayani ketiganya.

**Keputusan:**
- Pengaturan provider per-user di tabel `ai_provider_settings` (bukan env) — apiKey disegel AES-256-GCM via keyRing yang sama dengan kredensial router (AAD `ai-provider`); GET tidak pernah mengembalikan key, hanya `hasKey`. Env `AI_PROVIDER_*` hanya default server.
- **Auto-fetch model**: backend mem-proxy daftar model saat user mengisi apiKey/baseUrl — Gemini native `GET /v1beta/models` (header `x-goog-api-key`, filter `supportedGenerationMethods` memuat `generateContent`), OpenRouter/Custom `GET {base}/models` Bearer. Key transient, tidak disimpan. Model tetap bisa ditulis manual. Timeout 12s; error typed `UPSTREAM_AUTH_FAILED`/`UPSTREAM_TIMEOUT`/`UPSTREAM_ERROR`.
- Run tanpa router terhubung: katalog dibatasi `docs:*` + policy mode dipatok read-only v0 — percakapan dokumentasi tetap berfungsi, operasi router menjelaskan kebutuhan koneksi (`TOOL_UNSUPPORTED`).
- Nama tool di-namespace ke ruang provider (`[^A-Za-z0-9_-]` → `_`) dan dipetakan balik ke fqName saat eksekusi; tool `docs:*` dieksekusi via rosetta in-process.

**Bukti:** E2E dengan mock deterministik + fake provider OpenAI-compatible lokal (ports 3998/3999): auto-fetch [test-model-a,b], key salah → UPSTREAM_AUTH_FAILED, tool loop penuh `docs:routeros_search` Rosetta nyata ("safe mode" → halaman manual MikroTik Configuration Management) → jawaban final → run.completed usage; SSE replay + heartbeat + snapshot + cancel + idempotency resumed:true; 17 unit test agent (model-fetch 6, provider-settings 7, loop 4) + total 87 test API, typecheck + lint bersih.

**Batas jujur:** Gemini & OpenRouter nyata BELUM diuji — user belum memberi API key provider; bukti saat ini via adapter yang sama (protokol OpenAI-compatible) terhadap fake provider lokal. `.env.example` tidak berisi key nyata.

## D-012 — Storage B2 memakai NATIVE B2 API, bukan S3-compatible (AWS SDK ditolak untuk keyID Master)

**Tanggal:** 5 Sep 2026 (M8). Saat implementasi upload, `@aws-sdk/client-s3` (S3-compatible endpoint B2 `s3.us-west-004.backblazeb2.com`) menolak kredensial dengan "Malformed Access Key Id" — parser SigV4 AWS tidak menerima keyID Master B2 yang berformat 12 karakter hex (`b7b05c52b0a4`), berbeda dengan format keyID aplikasi S3 B2 (`00accountId_hex_00keyName`). Key non-master `mikrotik-key` sendiri sudah terbukti 401 invalid di M6 (D-010).

**Percobaan & bukti:** keyID Master yang sama AUTHENTIKASI SEMPURNA via native B2 JSON API: `b2_authorize_account` 200 → `b2_list_buckets` (bucket `mikrotik-agent` = `bb37ebf0b56c7502ab000a14`) → `b2_get_upload_url` 200 → upload 200. Karena itu AWS SDK di-uninstall dan `services/storage.ts` ditulis di atas native B2 API: authorize (cache token 60 menit) → get_upload_url per objek → upload dengan `X-Bz-Content-Sha1`; download via `downloadUrl/file/{bucket}/{key}` + Authorization header (bucket tetap private); delete via list_file_names → delete_file_version.

**Keputusan:** Native B2 API menjadi jalur storage (satu-satunya yang terbukti bekerja dengan kredensial yang user miliki). Tidak ada presigned URL ke browser — upload/download semua di-proxy backend sehingga ownership check per-request tetap berlaku.

**Dampak:** M8 upload/download/delete E2E nyata ke bucket produksi terbukti; catatan di plan.md M8 diperbarui. Jika kelak user membuat application key S3 yang valid, migrasi ke S3-compatible bisa jadi optimasi (streaming multipart) tanpa mengubah kontrak route.

## D-013 — Lab SSH container untuk E2E tanpa router fisik

**Tanggal:** 6 Sep 2026 (M10). Router lab fisik tidak tersedia; untuk membuktikan alur connector nyata (probe SSH, persist, connect, mode), dipakai container `atmoz/sftp:alpine` di `192.168.56.1:2222` (host-only adapter VirtualBox — bukan loopback, lolos target-policy; loopback sendiri terbukgi ditolak `HOST_NOT_ALLOWED`). Probe SSH nyata (child process MCP auth-check) berhasil; connector status `connected`; run dengan router terikat mengirim katalog penuh dan memanggil tool nyata.

**Batas jujur:** Container ini adalah server SSH generik, BUKAN RouterOS — command RouterOS tidak dieksekusi di dalamnya; mutasi Safe Mode nyata tetap menunggu router lab fisik (gap-open). E2E ini membuktikan jalur transport/autentikasi/state, bukan efek konfigurasi router.

## D-014 — Rate limit run in-process sliding window

**Tanggal:** 6 Sep 2026 (M10). Rate limit run per user (20 run/60 detik) diimplementasikan in-process sliding window di `routes/chat.ts` — tanpa Redis/store eksternal agar dev tetap zero-dependency.

**Dampak & batas:** Cukup untuk deployment single-node; untuk multi-node/HPA, store terpusat (Redis) adalah TODO production yang tercatat — jangan dianggap sudah menangani skala horizontal.

## D-015 — Retensi objek B2: hapus saat conversation dihapus; sweep berjadwal ditunda

**Tanggal:** 6 Sep 2026 (M10). DELETE `/api/conversations/:id` menghapus SEMUA objek B2 milik percakapan (loop per objectKey dengan validasi prefix `attachments/${userId}/`) sebelum cascade DB — terbukti E2E (objectsRemoved + listing B2 bersih). Sweep orphan berkala (objek tanpa record DB, misal upload yang gagal setelah B2 sukses) belum diimplementasikan — dicatat sebagai TODO production, bukan klaim selesai.
