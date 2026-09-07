# Recovery lokal

Hentikan aplikasi dengan Ctrl+C sebelum backup seluruh ~/.mikrotik-agent. Simpan agent.sqlite, sidecar SQLite bila ada, credential.key dan attachments bersama. Corpus dapat diunduh ulang.

Restore ke folder kosong lalu jalankan mikrotik-agent run --data-dir <folder>. Key hilang membuat secret lama tidak bisa dibuka: pulihkan key yang cocok atau isi ulang kredensial. Jangan mengganti key sembarangan.

Restart menandai transaksi belum terminal unknown, menonaktifkan Write, menandai connector disconnected dan run terputus failed. Tidak ada replay mutasi. Periksa router dan Safe Mode sebelum rekonsiliasi transaksi melalui API. Unknown bukan bukti rollback.

Migrasi SQLite otomatis, transaksional dan memakai PRAGMA user_version. Data dari versi aplikasi lebih baru ditolak. Backup sebelum upgrade; tidak ada down-migration otomatis.

Port bentrok: hentikan proses lama atau gunakan --port. Folder terkunci: hentikan instance pemiliknya. Lock proses mati dibersihkan otomatis pada run berikutnya.

Unduhan gagal: periksa internet dan ulangi run. Corpus rusak: hentikan aplikasi, pindahkan corpus ke backup, lalu jalankan ulang agar diunduh kembali.

Provider gagal: perbarui key/model di UI. SSH gagal: periksa alamat, port, jaringan, kredensial dan fingerprint. Run gagal tidak mengulang mutasi otomatis.
