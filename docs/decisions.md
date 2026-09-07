# Keputusan — 6 September 2026

- Pengguna memilih file lokal di laptop, bukan localStorage browser untuk data utama.
- SQLite bawaan Bun + Drizzle menggantikan database server; migrasi otomatis transaksional.
- Workspace adalah scope data internal, tanpa tabel akun dan fitur login.
- Lampiran disimpan di folder data pengguna dengan nama acak, validasi path, dan penulisan temporary lalu rename.
- Web React/Vite statis dilayani Hono bersama API dalam satu proses Bun pada loopback.
- CLI mikrotik-agent menyediakan run, port dan data-dir. Instalasi global memakai bun add -g setelah publikasi registry.
- Corpus diprovision otomatis pada run pertama. Dependency MCP tetap dipin.
- Key enkripsi unik dibuat otomatis; Host/Origin dan loopback menjadi batas akses.
- Provider AI Gemini/OpenRouter/custom dipertahankan, terpisah dari login yang dihapus.
- Pengaman router dipertahankan; restart menandai transaksi terputus unknown dan mematikan Write.
