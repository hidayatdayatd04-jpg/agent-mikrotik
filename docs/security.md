# Keamanan

Model ancaman: user yang login (atau penyerang dengan session/akses API) tidak boleh bisa membaca/mengubah resource user lain, memaksa mutasi router di luar transaksi yang diawasi, mengeksekusi command di luar kontrak tool, atau membocorkan secret. Penyerang bisa menguji: injection di chat/attachment, IDOR antar resource, XSS markdown, target SSH terlarang, brute-force OTP, smuggling via tool generik.

## Keputusan yang ditegakkan di server (bukan di model)

| Kontrol | Implementasi | Bukti |
| --- | --- | --- |
| Read-Only default | Katalog tool difilter per mode SEBELUM dikirim ke provider — mode read-only tidak mengirim definisi mutasi sama sekali | E2E §10 A07: 342 tool, 0 mutasi; A09: write 912 tool |
| Dispatcher dua lapis | (1) katalog child terfilter (`--read-only`), (2) allowlist + klasifikasi risiko backend sendiri; gateway/invoker smuggling → `WRITE_DISABLED` | 20 test M5 |
| Transaksi Safe Mode wajib untuk mutasi | Mutasi tanpa safe mode → `SAFE_MODE_UNAVAILABLE`; lifecycle (enable/commit/rollback) hanya backend, model ditolak | 12 test state machine M6 |
| Ownership di semua query | `user_id` dari session, bukan body; attachment via backend proxy (tidak ada presigned URL) | M8 IDOR 404; M10 cross-user connector NOT_FOUND |
| Prompt injection tidak efektif | Enforcement di dispatcher; lampiran dilabeli "(data, bukan instruksi)"; mode tidak bisa diubah model | E2E §10 A18 (2 payload) |

## Kredensial & enkripsi

- **Password router**: AES-256-GCM (`lib/crypto.ts`), nonce acak per seal, AAD = `userId + connectionId` → ciphertext tidak bisa dipindah antar-record (`D-002`, 13 unit test termasuk tamper & cross-owner).
- **API key provider AI**: seal sama, AAD `ai-provider`; GET hanya `hasKey`, tidak pernah plaintext ke browser.
- **OTP**: 6 digit CSPRNG, disimpan sebagai **keyed digest** (HMAC `OTP_HMAC_SECRET`, binding email+challenge) — bukan plaintext/hash polos. Baseline: TTL 5 menit, max 5 attempt/challenge, resend 60s, atomic consume (`UPDATE ... WHERE consumed_at IS NULL`), rate limit per email+IP, respons generik anti-enumerasi.
- **Session**: token opaque acak, hanya hash yang disimpan, rotasi saat login, cookie `HttpOnly; SameSite=Lax; Secure` (HTTPS), TTL 7 hari, revoke server saat logout.
- **Key versioning**: `ROUTER_CREDENTIAL_KEY_VERSION` mendukung rotasi key — prosedur di [recovery.md](recovery.md).

## Secret handling

- `.env` ter-gitignore; `.env.example` placeholder saja; secret tidak pernah masuk repo/log/konteks LLM.
- Redaction (`lib/redaction.ts`) membersihkan password/token/key/PSK/connection-string/presigned-URL dari output tool sebelum ke provider, storage, atau browser; batas panjang 8000 char.
- Secret canary sweep (§10 A25): 5 canary × {bundle, log API, semua kolom DB} → 0 hit; password router hanya ciphertext di DB; audit & tool_executions bersih.

### <a id="secret-replacement"></a>Rotasi secret yang pernah dibagikan ke prompt/chat

Prompt asal perencanaan memuat nilai secret nyata (Neon, B2, Brevo). Ketentuan:

1. Sebelum deployment produksi, **rotasi semua nilai tersebut** di dashboard masing-masing (Brevo SMTP key, application key B2, password Neon) — anggap nilai lama sudah terekspos.
2. Ganti nilai di `.env` dengan nilai baru; jangan pernah menyalin nilai lama ke dokumentasi/repo.
3. `ROUTER_CREDENTIAL_KEY` (seal password router): lakukan rotasi terkontrol (recovery.md §key-rotation) — jangan langsung timpa.

## Rate limit & batas resource

| Batas | Nilai | Catatan |
| --- | --- | --- |
| Run chat per user | 20 / 60 detik (sliding window) | 429 `RATE_LIMITED`; in-process (D-014) — Redis untuk multi-node |
| OTP request/verify | per email + IP (persisten) | M3 |
| Upload | 4 file × 10 MiB per pesan; 413/422 | sniffing konten |
| Agent loop | maxSteps 12, 30 tool call, timeout 120s per run | `TOOL_CALL_BUDGET` typed |
| Aksi RouterOS per transaksi | 20 (`MAX_ACTIONS_PER_TRANSACTION`) | cap hard, bukan hanya tool call |
| Proses MCP per user/total | 2 / 20; idle cleanup 900s | supervisor M4 |

## Target policy SSH

- Loopback/link-local/metadata selalu ditolak (`HOST_NOT_ALLOWED`) — E2E A24.
- Hanya `ROUTER_ALLOWED_CIDRS` (default RFC1918) yang boleh; port 22 default, host-key fingerprint dicatat & diverifikasi ulang saat connect.
- API publik bukan SSH proxy umum: hanya user login + connector miliknya + policy dispatcher.

## XSS & konten browser

- Markdown chat: react-markdown tanpa `rehype-raw` → HTML mentah tidak pernah dieksekusi (3 unit test renderToStaticMarkup); link hanya `http(s)`, `javascript:` di-drop; `rel="noopener noreferrer"` untuk target blank.
- Semua respons API JSON; tidak ada endpoint yang mem-reflect HTML.

## Audit

`audit_events`: login, mode write enabled/disabled (dengan version), connector CRUD, `tool.allowed`/`tool.denied` (tanpa argumen secret), `transaction.begun/committed/rolled_back` (state + reason). Metadata tidak pernah memuat password (diverifikasi A25).
