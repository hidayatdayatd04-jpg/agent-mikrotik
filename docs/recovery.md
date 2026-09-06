# Recovery & Operasional

Prosedur pemulihan untuk kegagalan yang diketahui. Prinsip: **tidak ada klaim sukses palsu** — bila keadaan router tidak pasti, status `unknown` dan diverifikasi manual sebelum lanjut.

## Transaksi Safe Mode yang gagal / backend restart

State machine transaksi (`transactions/coordinator.ts`) menyimpan fase **sebelum** aksi; crash di tengah menghasilkan `unknown`, bukan sukses/rollback palsu.

1. Cek `change_transactions` untuk router yang bersangkutan: `select id, state, router_identity, updated_at from change_transactions where state in ('unknown','rolling_back','preparing','active','verifying') order by updated_at desc;`
2. Status `unknown`: **jangan replay mutasi**. Hubungi router (SSH/Winbox), cek apakah Safe Mode window masih aktif:
   - Window masih aktif → jalankan `/system safe-mode release`? **Tidak** — jalankan **rollback** dari router (Ctrl+X / tombol discard) agar perubahan dibatalkan, lalu tandai manual di DB: `update change_transactions set state='rolled_back', outcome='manual-rollback' where id='<id>';`
   - Window sudah tertutup → perubahan sudah commit implicit oleh RouterOS (perilaku Safe Mode): bandingkan konfigurasi (`/export`) dengan backup, putuskan keep/undo manual, lalu `update ... set state='committed', outcome='manual-verify';`
3. `reconcile()` coordinator otomatis menutup buku `unknown` tanpa replay — dipanggil saat transaksi baru dimulai router yang sama (test M6). Sisa manual: verifikasi kunci status router.
4. Rollback yang di-drop di tengah juga `unknown` — prosedur sama (window probe).

## Migrasi database gagal

- Drizzle migrasi transaksional: batch gagal → tidak apply parsial; journal `__drizzle_migrations` tetap konsisten.
- Pulihkan: perbaiki SQL/migrasi → jalankan ulang `bun run db:migrate`.
- Neon produksi: jalur neon-http (`apps/api/scripts/migrate-neon.ts`), koneksi pooler bisa ECONNRESET dari beberapa jaringan (D-010) — jalur itu hanya untuk migrasi, app harian pakai pooled `DATABASE_URL`.
- Rollback versi: tidak ada down-migration otomatis; kembalikan schema via migrasi forward baru (konvensi drizzle).

## Rotasi `ROUTER_CREDENTIAL_KEY` (seal password router)

1. Generate key baru: `bun -e "console.log(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))"`.
2. Di `.env`: pindahkan key lama ke `ROUTER_CREDENTIAL_KEY_PREVIOUS` + `ROUTER_CREDENTIAL_KEY_PREVIOUS_VERSION=<versi-lama>`; isi key baru di `ROUTER_CREDENTIAL_KEY`, naikkan `ROUTER_CREDENTIAL_KEY_VERSION` (mis. 1 → 2).
3. Restart backend. Keyring sekarang multi-versi (test `makeKeyRing`): record lama (`key_version` < versi baru) tetap ter-decrypt dengan key PREVIOUS; seal baru memakai versi baru.
4. Re-seal: password router di-seal ulang otomatis saat connect ulang (user disconnect → connect) atau update credential; API key provider ter-seal ulang saat user menyimpan ulang. Pantau migrasi: `select key_version, count(*) from router_connections group by 1;` (dan `ai_provider_settings`).
5. Setelah semua row versi baru: hapus `ROUTER_CREDENTIAL_KEY_PREVIOUS*` dari env. Simpan key lama di secret manager untuk restore backup lama — bukan di repo.

## Backup

| Objek | Cara | Retensi |
| --- | --- | --- |
| Database Neon | export `pg_dump --schema=public` berkala / Neon point-in-time restore | sesuai kebijakan Neon plan |
| Bucket B2 `mikrotik-agent` | native B2 `b2_list_file_names` + `b2_download_file_by_name` per objek (key `attachments/{userId}/{conversationId}/{hex}.{ext}`) | objek ikut hidup conversation; DELETE conversation menghapus objek (D-015) |
| Corpus Rosetta | regenerasi dari `tooling/` (persist di `ROSETTA_DATA_DIR`); rebuild via spike script M0 | ulang saat upgrade versi rosetta |
| `.env` | backup manual di secret manager (bukan repo) | — |

## Proses MCP child bermasalah

- Supervisor (M4) me-respawn on-demand; crash child → respawn saat tool berikutnya dipanggil (test teruji).
- Idle 900s → otomatis stop (tidak ada proses yatim, test teruji).
- Gagal total: `POST /api/connectors/:id/disconnect` → forceRollback live tx + stop child; connect ulang.
- Limit: 2 child/user, 20 total; penuh → error jelas, tidak deadlock.

## Provider AI gagal

- Run → `run.failed` typed (`UPSTREAM_AUTH_FAILED`/`UPSTREAM_ERROR`/`UPSTREAM_TIMEOUT`); tidak ada retry mutasi.
- Key per-user: user ganti key di UI Provider AI (auto-fetch model memvalidasi key sebelum disimpan).

## Brevo gagal kirim OTP

- SMTP terblokir/network down → OTP request gagal jelas; **OTP tidak dicetak ke log produksi** (hanya mode dev mock).
- Sender belum terverifikasi → Brevo menolak; verifikasi sender di dashboard Brevo dulu, isi `BREVO_SENDER_EMAIL`.

## B2 gagal (upload/download)

- Upload gagal → tidak ada record DB persist (insert setelah B2 sukses); client coba lagi aman (idempotent by conversation attachment).
- Orphan objek B2 (B2 sukses tapi record gagal): belum ada sweep otomatis (D-015 TODO) — listing `attachments/{userId}/` vs tabel `attachments` untuk audit manual.
- Download proxy gagal → 5xx jelas; tidak ada fallback yang membocorkan URL.

## Kontinuitas sesi

- Session 7 hari; refresh browser aman (cookie tetap); logout revoke server.
- Run aktif + refresh → SSE reconnect (`GET /api/runs/:id/events?from=`), replay tanpa duplikasi, run tidak dieksekusi ulang (idempotencyKey).
