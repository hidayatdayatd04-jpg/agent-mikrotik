# Setup lokal

Bun >=1.3.3 diperlukan. Instalasi registry: `bun add -g mikrotik-agent` setelah publikasi. Sebelum itu gunakan tarball sesuai README.

`mikrotik-agent run` melayani web dan API pada http://localhost:3000, bind 127.0.0.1. Tidak membutuhkan .env. Setup data otomatis dan unduhan corpus pertama memerlukan internet. Kegagalan unduhan menghasilkan exit nonzero dan dapat dicoba lagi.

Opsi: `--port <1-65535>`, `--data-dir <folder>`. Default folder ~/.mikrotik-agent. CLI dapat dijalankan dari direktori mana pun. Port bentrok dan folder data yang sedang dipakai instance lain ditolak.

Isi Provider AI dan Connector melalui UI. Aplikasi ditujukan untuk laptop; proses lokal yang dapat mengakses loopback mempunyai akses ke workspace yang sama.

Developer: bun install, bun run build, bun run start. Setelah provisioning, hot reload tersedia melalui bun run dev. SQLite bermigrasi otomatis saat startup.

Pembuatan paket: bun pm pack menjalankan prepack build. Isi paket dibatasi bin, dist, README dan manifest. Secret, data pengguna, corpus, node_modules dan source workspace tidak dibundel. Publikasi registry adalah langkah rilis terpisah; penerbit harus memiliki nama paket.
