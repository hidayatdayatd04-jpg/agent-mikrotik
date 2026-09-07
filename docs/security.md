# Keamanan lokal

Satu workspace dengan satu akun lokal yang dibuat otomatis secara idempotent: username **mikrotik-agent** atau alias login literal **mikrotikagent**. Password awal **mikrotik123 wajib diganti setelah login pertama** melalui Pengaturan → Keamanan & Safe Mode → Ubah password; restart tidak meresetnya. Halaman login tidak menampilkan password default. Tidak ada registrasi, email OTP, atau OAuth.

Password di-hash dengan Argon2id (fallback bcrypt). Session server memakai token acak yang disimpan sebagai hash di database dan cookie **ma_session** dengan HttpOnly, SameSite=Lax, Path=/, serta Secure pada HTTPS; masa berlaku 30 hari. Login memiliki rate limit. Logout mencabut session; perubahan password mencabut session lain. Token tidak disimpan di localStorage. Middleware sessionAuth dipasang global, lalu guard route mewajibkan session untuk akses data/API/SSE/terminal; endpoint publik seperti login dan health tetap dapat diakses tanpa login.

Server bind 127.0.0.1 dan memvalidasi Host, Origin, serta Sec-Fetch-Site. Semua route, termasuk GET dan SSE, melewati pemeriksaan tersebut sebagai lapisan tambahan di samping autentikasi.

Password router dan API key disegel AES-256-GCM dengan AAD yang mengikat workspace dan record. Key unik dibuat otomatis di credential.key. File dibuat mode 0600 dan folder 0700 pada OS yang mendukung mode POSIX; Windows memakai ACL folder pengguna. Enkripsi ini tidak melindungi dari proses yang sudah dapat membaca database dan key. Lampiran tidak dienkripsi.

Browser menerima DTO aman dan hasKey. Secret tidak masuk konteks model. Output tool disaring sebelum logging dan provider.

Read-Only ditegakkan backend; tool tanpa klasifikasi ditolak. Mode diperiksa ulang dengan compare-and-set. Target SSH melalui policy jaringan dan pinning fingerprint. Mutasi wajib melalui coordinator Safe Mode. Restart menandai transaksi terputus unknown dan mematikan Write.

Lampiran memiliki nama acak, validasi path, batas ukuran request dan pemeriksaan konten. Download memakai Content-Disposition attachment dan nosniff. Markdown menolak HTML mentah dan javascript URL.

Tes mencakup enkripsi, policy, Host/Origin, traversal, restart, MCP dan Safe Mode. Pengujian router fisik tetap diperlukan untuk membuktikan rollback nyata.
