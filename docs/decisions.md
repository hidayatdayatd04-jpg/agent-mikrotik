# Keputusan — 6 September 2026

- Pengguna memilih file lokal di laptop, bukan localStorage browser untuk data utama.
- SQLite bawaan Bun + Drizzle menggantikan database server; migrasi otomatis transaksional.
- Workspace adalah scope data internal yang tetap terikat ke data lama. Satu akun lokal di-seed secara idempotent: username mikrotik-agent, alias login literal mikrotikagent, dan password awal mikrotik123 yang wajib diganti setelah login pertama. Restart tidak mereset password.
- Login lokal mengikuti kontrak di prompt-ai-agent.md: hash password Argon2id (fallback bcrypt), session server dengan cookie ma_session HttpOnly, expiry dan rate limit login. Tidak memakai registrasi, email OTP, atau OAuth.
- Lampiran disimpan di folder data pengguna dengan nama acak, validasi path, dan penulisan temporary lalu rename.
- Web React/Vite statis dilayani Hono bersama API dalam satu proses Bun pada loopback.
- CLI mikrotik-agent menyediakan run, port dan data-dir. Instalasi global memakai bun add -g setelah publikasi registry.
- Corpus diprovision otomatis pada run pertama. Dependency MCP tetap dipin.
- Key enkripsi unik dibuat otomatis; session login, validasi Host/Origin dan loopback melindungi akses.
- Provider AI Gemini/OpenRouter/custom dipertahankan, terpisah dari kredensial login lokal.
- Pengaman router dipertahankan; restart menandai transaksi terputus unknown dan mematikan Write.
