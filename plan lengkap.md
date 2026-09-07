# Plan lengkap — MikroTik Agent

Tanggal: 7 September 2026  
Status: spesifikasi untuk diserahkan kepada AI coding; belum merupakan implementasi.  
Workspace: D:/agent-mikrotik

## 1. Tujuan dan batas pekerjaan

Ubah MikroTik Agent menjadi aplikasi chat yang bersih, dengan navigasi pengaturan terpusat, akun lokal, pengelolaan percakapan lengkap, compact konteks otomatis, serta terminal RouterOS untuk pengguna dan AI. Ikuti referensi gambar pengguna, sambil mempertahankan fungsi backend dan pengaman router yang sudah berjalan.

Dokumen ini menjadi kontrak implementasi. Pembuat dokumen hanya menulis rencana dan prompt; AI coding penerima yang mengerjakan kode, migrasi, pengujian, dan validasi tampilan. Jangan reset, checkout, menghapus, atau menimpa perubahan pengguna yang sudah ada.

Hasil implementasi harus berupa fitur yang berfungsi dari UI sampai penyimpanan dan backend. Jangan mengganti integrasi nyata dengan mock, tombol tanpa aksi, atau data status buatan.

## 2. Kondisi kode saat rencana dibuat

Temuan berikut berasal dari pembacaan repo, bukan asumsi rancangan:

| Area | Kondisi sekarang | Titik integrasi |
| --- | --- | --- |
| Shell aplikasi | View chat/connectors/settings dikendalikan state; sidebar dan theme toggle ada dalam App | apps/web/src/App.tsx |
| Router percakapan | Dropdown router, pilihan tanpa router, badge mode, dan toggle Write masih tampil di bagian atas chat | apps/web/src/features/chat/ChatScreen.tsx |
| Composer | Menu (+), lampiran, model, Write, dan context meter sudah ada | apps/web/src/features/chat/ChatComposer.tsx |
| Halaman awal | Hero dan kartu saran yang diminta dihapus masih digunakan | apps/web/src/features/chat/ChatWelcomeHero.tsx; ChatPanel.tsx; App.tsx |
| Pengaturan | Halaman sudah ada dengan tab Provider, Safe Mode, Tentang | apps/web/src/features/chat/SettingsPage.tsx |
| Proses tool | UI hanya menyimpan nama/status sederhana; hasil tool belum menjadi timeline persisten lengkap | ChatPanel.tsx; use-run-events.ts |
| Backend chat | Hono, background agent loop, SSE hub, transaksi Safe Mode; perbaikan begin lengkap dan settlement sudah ada | apps/api/src/routes/chat.ts; agent/loop.ts; agent/hub.ts |
| History model | Loop memuat maksimum 24 message terakhir; belum ada compact konteks persisten | apps/api/src/agent/loop.ts |
| Penyimpanan | SQLite + Drizzle; workspaces menjadi pemilik data, messages mempunyai seq, conversations sudah mempunyai createdAt/updatedAt/deletedAt | apps/api/src/db/schema.ts; db/migrations.ts |
| Autentikasi | Request memakai localWorkspace; middleware local-only ada, tetapi bukan login pengguna | apps/api/src/index.ts; middleware/local-only.ts |
| Terminal | SSH probe dan child MCP ada; UI/API terminal pengguna belum ada | services/ssh-probe.ts; mcp/*; transactions/* |
| Pengaman | Dispatcher memeriksa mode live, katalog dan argumen; lifecycle Safe Mode dikelola backend | policies/dispatcher.ts; transactions/coordinator.ts |

Nama komponen baru dalam dokumen ini adalah usulan. Sebelum mengedit, cari simbol terbaru karena pengguna dapat mengubah repo setelah rencana dibuat. Jangan memulihkan sistem OTP/email lama hanya karena file auth lama terlihat di riwayat Git.

## 3. Acuan visual dan keputusan desain

Gunakan gambar berdasarkan isinya, karena penomoran dalam pesan pengguna tidak sepenuhnya berurutan.

| Acuan | Terjemahan ke produk |
| --- | --- |
| Header lama berisi nama router, Mode: Read-Only dan Write | Hapus seluruh kontrol router/mode dari header chat; pemilihan connector dan Write ada di composer |
| Sidebar lama Connector Router / Pengaturan / Provider & Safe Mode | Hapus pintasan Connector Router dari sidebar chat; hilangkan subtitle Provider & Safe Mode |
| Menu profil dengan avatar di bawah sidebar | Buat menu profil nyata dengan Profil, Pengaturan, Personalisasi/Tampilan, tema, Bantuan, Keluar |
| Sidebar ChatGPT terbuka | Susunan chat baru, cari chat, kelompok percakapan, profil di bawah |
| Sidebar ikon sempit | Mode sidebar tertutup tetap menyediakan tombol buka, chat baru, cari chat dan avatar |
| Layar awal dengan pertanyaan singkat dan composer tengah | Layar chat baru kosong, lapang, hanya sapaan pendek dan composer |
| Menu titik tiga Share/Pin/Archive/Delete | Gunakan menu percakapan: export Markdown, rename, pin, arsip, hapus; tidak perlu layanan share publik |
| Baris Ran commands dengan chevron | Tampilkan proses aktual dalam baris ringkas; detail dibuka dengan chevron kanan |
| Panel Shell gelap dengan output dan exit code | Bedakan terminal hasil eksekusi dari blok kode jawaban biasa |

Arah visual: chat utilitarian yang tenang. Utamakan ruang kosong, Geist yang sudah tersedia, warna netral, border tipis, ikon lucide-react, dan panel terminal yang mudah dipindai. Jangan mengganti dengan hero marketing, kartu gradient, atau dashboard penuh badge.

Token usulan, sesuaikan dengan token semantik CSS yang sudah ada:

| Token | Light | Dark |
| --- | --- | --- |
| Canvas | #FFFFFF | #171717 |
| Sidebar/surface sekunder | #F7F7F8 | #202020 |
| Teks utama | #202123 | #ECECEC |
| Teks sekunder | #6B7280 | #A1A1AA |
| Border | #E5E7EB | #343434 |
| Aksen interaksi | #2563EB | #60A5FA |

Gunakan Geist untuk UI, system monospace untuk kode/output. Teks UI 14–16 px, nama percakapan 14 px, metadata 11–12 px. Sidebar terbuka sekitar 264–288 px, tertutup 56–64 px; konten chat maksimum sekitar 800–900 px. Composer beradius 20–28 px, menu 12–16 px. Ini pedoman desain, bukan ukuran kaku.

## 4. Peta halaman dan navigasi

Rute konseptual berikut harus mendukung refresh dan tombol back/forward. Gunakan routing yang ringan dan konsisten dengan stack; bila memilih dependency baru, jelaskan manfaatnya dalam hasil implementasi.

~~~text
/login
/chat                         chat baru
/chat/:conversationId         chat tersimpan
/settings                     arahkan ke halaman default pengaturan
/settings/connectors          Connector Router
/settings/providers           Provider AI
/settings/profile             Profil
/settings/appearance          Tampilan dan tema
/settings/context             Konteks dan compact otomatis
/settings/security            Keamanan, password, status Safe Mode
/settings/archive             Arsip percakapan
/settings/about               Tentang dan diagnostik
/settings/help                Bantuan
~~~

Sidebar chat: logo kecil, tombol buka/tutup, Chat baru, Cari percakapan, daftar percakapan, avatar profil. Tidak ada item navigasi langsung Connector Router atau Provider AI. Pengaturan dibuka melalui menu profil.

Sidebar pengaturan: Kembali ke chat, Connector Router, Provider AI, Profil, Tampilan, Konteks, Keamanan & Safe Mode, Arsip, Tentang, Bantuan. Pindahkan seluruh halaman konfigurasi yang sudah ada ke shell ini, dengan deep link dan active state yang jelas. Jangan tampilkan dua sidebar berdampingan.

Hapus teks “Provider & Safe Mode”, “Workspace lokal” beserta variasi salah ketiknya dari sidebar. Penghapusan label tidak menghapus workspace di database.

Jangan menambahkan menu Upgrade plan, billing, Library, Projects, Scheduled tasks, voice atau plugin hanya karena terlihat di referensi. Tampilkan menu yang mempunyai fungsi nyata dalam scope ini.

## 5. Composer: Connector dan Write

### Perilaku menu (+)

Urutan minimum: Connector, Tambah router, Lampiran/file/gambar yang sudah didukung, Izinkan perubahan, Compact percakapan. Pemilih model tetap tersedia di composer.

- Ganti label “Router percakapan” menjadi “Connector”.
- Connector membuka sub-menu/popover berisi connector tersimpan, label/IP, status aktual, dan penanda pilihan.
- Tambah router memakai ikon Plus; membuka /settings/connectors dengan form tambah aktif.
- Simpan returnTo menuju chat asal. Setelah berhasil menambah/menghubungkan router, pengguna dapat memilih “Gunakan di chat ini” lalu kembali dengan draft dan lampiran tetap utuh.
- Hapus item “Tanpa router”, “Tanpa router (dokumentasi saja)” dan “Dokumentasi saja”.
- Hilangnya item tersebut tidak mewajibkan router untuk chat umum. Backend tetap menerima conversation dengan connectionId null.
- Saat belum ada connector, gunakan status ringan “Belum terhubung” di menu, bukan sebuah opsi mode dokumentasi.
- Router yang sedang disconnected tetap terlihat dengan status akurat dan aksi menuju pengaturan koneksi. Jangan mengklaim connected berdasarkan pilihan UI.
- Jika target belum dapat digunakan, pertanyaan umum tetap diproses; permintaan data/router dijawab jujur bahwa router belum terhubung. Jangan mengarang hasil tool.
- Tidak perlu menambahkan opsi pelepasan router baru yang hanya mengganti nama “Tanpa router”. Conversation tanpa binding tetap didukung secara internal.

### Kesatuan state

Composer chat baru dan chat tersimpan memakai komponen dan state pemilihan yang konsisten. Pilihan pada chat baru disimpan dalam draft lalu diteruskan saat createConversation; pada chat tersimpan memakai PATCH conversation.

Perbaiki fallback di App bila activeConnectionId sudah menunjuk connector tertentu: jangan diam-diam memakai connector lain yang connected. UI, run, terminal dan backend harus merujuk connectionId yang sama.

Saat run/terminal command sedang aktif, penggantian target ditahan dengan alasan singkat. Pergantian connector tidak pernah mengaktifkan Write otomatis. Write ON hanya jika connected dan identity terverifikasi; Write OFF tetap tersedia untuk mencabut izin. Pesan 409 memakai pesan server.

Hapus badge “Mode: Read-Only” dan toggle Write dari header. Status transaksi aktual tetap tampil di timeline proses atau composer saat relevan; jangan membuat indikator mode duplikat.

## 6. Layar chat baru dan header percakapan

### Chat baru

- Tidak ada header percakapan ketika belum ada message terkirim. Loading/optimistic state harus konsisten.
- Tetap ada affordance kecil untuk membuka sidebar, termasuk di mobile; ini bukan header router lama.
- Sapaan pendek: “Apa yang ingin Anda kerjakan?”.
- Composer berada di tengah area kosong, lalu berpindah ke bawah setelah pesan pertama dikirim.
- Hilangkan judul hero “MikroTik AI Agent”, paragraf marketing, dan seluruh kartu Monitoring, Keamanan, Konfigurasi, Diagnostik serta “Gunakan saran ini”.
- Hapus pemanggilan hero lama pada App dan ChatPanel, agar tidak muncul kembali pada conversation tersimpan yang masih kosong.
- Tidak ada kartu promosi, contoh pertanyaan, atau pintasan pengaturan di canvas awal.

### Header setelah percakapan memiliki pesan

Header transparan, tanpa bar berwarna atau border berat. Jaga keterbacaan dengan posisi/spacing yang tepat dan backdrop blur ringan hanya bila dibutuhkan saat scroll.

Kiri: buka/tutup sidebar dan judul percakapan. Tengah: jika meniru segmented Chat/Work pada gambar, definisikan Chat sebagai transcript dan Work sebagai tampilan proses/terminal untuk conversation yang sama; bukan mode izin tambahan atau halaman kerja fiktif. Kanan: Terminal, Export .md, menu titik tiga.

Menu titik tiga: Rename, Pin/Lepas pin, Arsipkan/Pulihkan sesuai keadaan, Compact percakapan, Export Markdown, Hapus. Aksi sidebar dan header harus memakai handler yang sama. Item “Lihat file chat” boleh ditambahkan sebagai daftar lampiran yang sudah nyata, bukan halaman kosong.

Header tidak memuat dropdown Connector, badge read-only, toggle Write, atau koneksi yang diduplikasi.

## 7. Sidebar chat, tanggal, dan pengelolaan percakapan

### Buka/tutup sidebar

Desktop: expanded sidebar dan collapsed icon rail. Preferensi dipersistenkan per akun di localStorage; hanya state tampilan yang disimpan di sana. Mobile: drawer overlay, tutup setelah memilih chat, dukung Escape dan pengembalian fokus. Gunakan tooltip dan aria-label pada semua ikon rail.

### Daftar chat

- Kelompok utama: Disematkan, Hari ini, Kemarin, 7 hari terakhir, Lebih lama.
- Pengelompokan recency memakai updatedAt; metadata pada setiap item tetap menampilkan tanggal dibuat dari createdAt, sesuai permintaan pengguna.
- Tooltip dapat menampilkan tanggal/jam lengkap dalam zona waktu browser. Jangan mengganti tanggal dibuat dengan tanggal aktivitas terakhir.
- Pin berada paling atas dan urut deterministik menurut pinnedAt; lainnya menurut updatedAt dan id sebagai tie-breaker.
- Menu titik tiga terlihat saat hover/focus, selalu mudah diakses pada touch.
- Pencarian bekerja pada judul chat minimum; tampilkan empty/loading/error state yang jelas.
- Tambahkan pagination/cursor agar chat lama tidak hilang karena limit daftar yang sekarang ada.
- Arsip tidak tampil di daftar aktif; tetap dapat diakses melalui Pengaturan → Arsip.

### Semantik aksi

| Aksi | Hasil |
| --- | --- |
| Rename/Edit nama | Ubah title, validasi panjang dan whitespace, simpan DB, tidak mengedit pesan |
| Pin chat | Simpan pinnedAt; bisa dilepas; bertahan setelah reload |
| Archive | Simpan archivedAt; hilang dari daftar aktif, history tetap utuh |
| Restore | Kosongkan archivedAt; kembali ke daftar aktif, pertahankan metadata pin bila ada |
| Delete | Konfirmasi singkat, ikuti cleanup attachment dan run aktif yang sudah berlaku; jangan menyisakan objek file |
| Export .md | Download seluruh transcript tersimpan milik pengguna beserta metadata dan catatan proses yang sudah disanitasi |

Rename/pin dapat berjalan tanpa mengubah run. Arsip/hapus ditolak saat run atau terminal yang terikat masih aktif, dengan petunjuk menghentikannya. Jika chat aktif diarsipkan/dihapus, tampilkan chat baru. Semua mutation memeriksa pemilik di server.

Export: nama file aman dari judul + tanggal, UTF-8, heading per role, timestamp, fenced code yang valid walaupun pesan memuat backtick, metadata connector tanpa kredensial, dan lampiran sebagai nama/metadata tanpa signed URL/key. Sertakan catatan compact dan proses yang tersimpan dalam bagian detail. Jangan memakai hanya 24 history model, 500 message UI, atau buffer SSE sebagai isi export. Saat run aktif, export merupakan snapshot sampai seq terakhir, diberi catatan run belum selesai; tidak mengeksekusi ulang apa pun.

## 8. Profil, tema, dan pengaturan

Avatar bawah sidebar menampilkan inisial MA dan nama akun mikrotik-agent. Klik avatar membuka menu seperti referensi: ringkasan profil, Profil, Pengaturan, Personalisasi, Tema Terang/Gelap/Sistem, Bantuan, Keluar.

Profil: display name, username, identitas alternatif, avatar inisial. Personalisasi membuka Tampilan. Bantuan berisi petunjuk connector SSH, penggunaan Write dan pemulihan koneksi yang relevan, bukan link mati.

Tema memakai token semantik dan preferensi yang persisten; default mengikuti sistem. Terapkan sebelum render utama untuk menghindari flash. Gunakan next-themes atau pola yang sudah ada, jangan mencampur dua pengelola tema.

Halaman pengaturan bukan form tunggal panjang. Setiap halaman memanfaatkan komponen bisnis yang sudah ada, misalnya ConnectorsPanel dan ProviderConfigDialog. Memindahkan UI tidak mengubah kontrak enkripsi password/API key.

## 9. Login lokal dengan akun yang diminta

Akun awal harus persis:

| Field | Nilai |
| --- | --- |
| Username | mikrotik-agent |
| Identitas alternatif, diminta sebagai email | mikrotikagent |
| Password awal | mikrotik123 |

Nilai mikrotikagent bukan alamat email berformat umum. Tetap terima literal ini sebagai alias login; gunakan input type=text dengan label “Username atau email”, jangan memaksa validator email atau mengubahnya menjadi alamat lain tanpa permintaan.

### Backend

- Buat akun lokal saat provisioning/migrasi pertama bila belum ada; proses idempotent dan tidak me-reset password tiap restart.
- Hash password dengan algoritme adaptif yang didukung runtime, utamakan Argon2id. Jangan menyimpan plaintext atau mengirim password seed ke bundle frontend. Pedoman hash: [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
- Hubungkan account baru ke workspace lokal lama. Field userId pada tabel existing saat ini menunjuk workspace; jangan mengganti nilainya menjadi accountId sehingga data lama tidak dapat diakses/dekripsi.
- Tambahkan middleware autentikasi nyata. Client-side AuthGate saja tidak cukup.
- Session berupa token acak, hash token disimpan server, cookie HttpOnly, SameSite, Path dan expiry jelas. Untuk HTTPS gunakan Secure; konfigurasi development loopback HTTP harus tetap dapat login, tanpa memakai prefix cookie yang mensyaratkan Secure secara keliru. Rujukan atribut session: [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
- Tetap pertahankan localOnly, validasi Host/Origin dan proteksi request mutasi. Jangan membuka API ke semua interface sebagai bagian perubahan login.
- Lindungi conversations, messages, SSE, export, attachments, provider, connector, transactions, compaction, terminal HTTP maupun transport streaming.
- Endpoint login/me/logout saja mengikuti pengecualian yang terukur. Assets login boleh publik; health minimal tidak membocorkan data.
- Batasi percobaan login dan gunakan pesan kegagalan umum. Token tidak disimpan di localStorage.
- Logout merevokasi session, menutup stream, membatalkan pekerjaan milik session terkait, dan melakukan cleanup transaksi/terminal aktif secara terkontrol. Jangan sekadar menghapus cookie saat mutasi tetap berjalan.
- Status session harus diperiksa saat menjalankan command dan saat stream berjalan; session yang revoked tidak boleh terus menerima output.
- Jika menyediakan perubahan password di Keamanan, verifikasi password lama dan revoke session lain. Jangan menambahkan registrasi, SMTP, OTP, reset email atau akun multi-tenant dalam scope ini.

### Frontend

Form login sederhana: identitas, password, tombol lihat password, tombol Masuk, loading dan pesan error Bahasa Indonesia. Jangan mencetak kredensial default pada halaman login. Setelah login arahkan ke intended route yang valid atau chat baru; cegah redirect ke domain luar.

Jika session habis, simpan draft nonrahasia sementara, arahkan login, lalu pulihkan draft setelah identitas terverifikasi. Bersihkan cache akun dan transcript dari layar ketika logout.

## 10. Compact percakapan manual dan otomatis

Compact berarti meringkas history yang dikirim ke model agar percakapan dapat berlanjut. History asli tidak dihapus, transcript visual tidak dipotong, dan export tetap lengkap.

### UX

- Pengaturan → Konteks: compact otomatis default ON, penjelasan singkat, ambang pemakaian, dan status terakhir.
- Composer context meter dan menu percakapan menyediakan “Compact percakapan”.
- Proses berjalan di backend sehingga pengguna tidak perlu memulai chat baru.
- Timeline menampilkan “Meringkas konteks…” lalu “Konteks diringkas; percakapan dilanjutkan”, atau kegagalan yang dapat dicoba ulang.
- Detail expandable: otomatis/manual, model, rentang message, waktu, token sebelum/sesudah; beri label estimasi bila bukan hitungan provider.
- Input tetap dapat diketik. Kiriman menunggu satu pekerjaan compact yang relevan; jangan membuat run paralel atau menghilangkan draft.
- Bukan animasi palsu/timer: status berasal dari pekerjaan server.

### Desain konteks

Buat service context builder dan compaction terpisah dari JSX. Prompt akhir terdiri atas instruction/katalog yang live, memory summary sebagai data tidak tepercaya, recent turns yang utuh, dan pesan baru/lampiran. Jangan memberi authority system pada instruksi yang berasal dari chat, log router, atau summary.

Budget harus memperhitungkan system instruction, schema tool, summary, history, lampiran, pesan baru, cadangan output dan margin. Ambang awal usulan 80% dari input budget efektif; target setelah compact sekitar 50–60%, dapat dikonfigurasi. Nilai ini adalah keputusan produk, bukan batas semua provider.

Gunakan context limit model terpilih dari metadata yang sudah ada. Token usage provider sebelumnya tidak boleh dianggap persis ukuran request berikutnya. Bila tokenizer tepat belum tersedia, pakai estimator konservatif berlabel estimasi dan fallback; jangan mengklaim estimasi karakter sebagai token aktual.

Summary menyimpan tujuan, preferensi eksplisit, fakta router beserta sumber/waktunya, keputusan, aksi tool yang sudah dieksekusi, status transaksi yang diketahui, error penting, dan tugas tersisa. State connector, izin Write dan transaksi harus dibaca ulang dari server; summary tidak dapat memberi otorisasi.

Simpan summary version, throughSeq, source revision, model/provider, hash input, budget dan status pekerjaan. Incremental compact menggabungkan summary lama dengan message yang belum diringkas; jangan menduplikasi turn terbaru. Pisahkan pasangan tool call/result sebagai unit atomik, termasuk output yang belum selesai; jangan membuat urutan pesan provider invalid.

### Waktu dan kegagalan

- Utamakan compact preflight sebelum membuka transaksi Safe Mode run baru.
- Evaluasi budget lagi sebelum setiap request provider, termasuk setelah tool menghasilkan output besar.
- Bila compact diperlukan di tengah run, lakukan hanya setelah seluruh pasangan tool call/result pada turn lengkap; gunakan deadline/cancel signal dan batas waktu yang sama. Summary call tidak memiliki tool eksekusi.
- Jangan membuat transaksi baru, commit dini, atau mengulang mutasi karena compact. Jika budget/deadline tidak memungkinkan lanjut, gunakan jalur gagal/cancel dan rollback yang nyata; tampilkan alasan.
- Gunakan satu pekerjaan per conversation + revision; kunci/CAS mencegah manual dan auto berjalan ganda.
- Tulis summary atomik setelah berhasil. Summary lama tetap valid jika provider gagal atau proses restart; sumber history tetap ada.
- Provider context overflow: compact lalu retry request model paling banyak sekali, hanya jika belum ada tool yang dieksekusi dari request itu. Jangan me-replay run/command.
- Output tunggal atau lampiran terlalu besar perlu clipping/chunking dengan metadata yang jujur; compact tidak boleh berputar tanpa batas.
- Saat pengguna mengganti model ke kapasitas lebih kecil, budget dihitung ulang sebelum request berikutnya.
- Jika provider belum dikonfigurasi, jangan menyatakan compact berhasil menggunakan respons mock.

## 11. Timeline proses tool di canvas chat

Semua aktivitas yang benar-benar dapat diamati harus tampil: tool baca/tulis/dokumentasi, pemeriksaan policy yang ditolak, command terminal AI, verifikasi, lifecycle transaksi, dan compact konteks.

“Semua proses” di sini berarti nama operasi, command/argumen tersanitasi, output terukur, durasi, status, error dan hasil transaksi. Jangan meminta atau memalsukan chain-of-thought, prompt internal rahasia, kredensial, atau reasoning tersembunyi model.

### Struktur UI

~~~text
>  Menjalankan 3 proses                         Selesai · 2,1 dtk
   >  Membaca identity                         Selesai
   v  Menjalankan perintah RouterOS             Selesai
      RouterOS terminal · CHR · AI
      /system identity print
      name: CHR
      Status: selesai · Exit code: tidak tersedia
   >  Memverifikasi transaksi                  Committed
~~~

Baris induk ber-chevron kanan; klik membuka daftar child. Setiap child dapat dibuka untuk detail, chevron berputar ke bawah. Aktivitas ditempatkan pada run/message yang benar dalam transcript, bukan seluruh proses menumpuk di bawah jawaban terbaru.

Gunakan activityId dan toolCallId, bukan nama tool atau “item running terakhir”; banyak panggilan tool bernama sama harus tetap dibedakan. Tampilkan status queued/running/completed/failed/cancelled/rejected/unknown secara jelas. Jika transport tidak menyediakan exit code, simpan null dan tampilkan “tidak tersedia”; jangan mengarang exit code 0.

### Persistensi dan streaming

Tambahkan event store persisten untuk event penting, dengan pagination dan sequence unik per run. Hub in-memory hanya transport/replay cepat, bukan satu-satunya histori. Reload harus memulihkan proses lama.

Envelope minimum: eventId, runId nullable, conversationId, activityId, parentId nullable, seq, type, actor=user|ai|system, timestamp, payload tersanitasi. Compaction di luar run dan terminal manual memerlukan event conversation/session; jangan memaksa semua aktivitas mempunyai runId yang fiktif.

Payload detail: kind, toolName, command/input, status, output chunks, durationMs, exitCode nullable, errorCode, connectionId, transactionId nullable, truncated. Gunakan batas ukuran, buffering/backpressure, dan penanda pemotongan. Store/API/output/export memakai redaksi yang sama.

SSE reconnect harus menduplikasi berdasarkan id/seq secara aman. Event transaksi akhir wajib terlihat sebelum run ditandai selesai; polling status tidak boleh menutup UI saat commit/rollback masih berjalan. Buat state “menyelesaikan transaksi” bila perlu, tanpa merusak kontrak status run existing.

Log server umum/debug tidak otomatis dikirim semua ke browser. Yang ditampilkan hanya kegiatan pengguna tersebut pada run/command terkait, dengan data yang aman dan berguna.

## 12. Blok kode dan terminal mempunyai desain berbeda

| Blok kode jawaban | Terminal/shell hasil eksekusi |
| --- | --- |
| Menampilkan contoh atau script, belum berarti dieksekusi | Hanya muncul setelah aktivitas eksekusi nyata |
| Label bahasa: RouterOS, JSON, Bash, PowerShell, dll sesuai isi | Label target RouterOS, actor AI/User, status dan waktu |
| Syntax highlight, salin, horizontal scroll | Prompt/command, output stream, error, durasi, exit code bila tersedia |
| Tidak memakai status sukses atau exit code | Tidak mengklaim sukses sebelum hasil dan settlement jelas |
| Aksi “Kirim ke terminal” mengisi draft saja | Eksekusi tetap melewati kebijakan backend |

Jangan menamai seluruh fenced code sebagai “RouterOS Script / Code”. Inline code mempunyai gaya sederhana yang tidak menyerupai panel terminal. HTML/ANSI/OSC dan output router diperlakukan sebagai data; sanitize link, kontrol terminal, escape sequence berbahaya, dan jangan mengaktifkan HTML mentah dari model.

## 13. Terminal RouterOS untuk pengguna

Tombol Terminal ada di header conversation yang sudah berisi pesan. Membuka panel kanan atau panel bawah yang dapat di-resize; mobile memakai drawer yang layak. Header panel menampilkan target connector, status, asal pengguna, tombol clear tampilan, salin, dan tutup. Riwayat command, multiline draft, submit dan cancel/interrupt didukung.

Terminal terhubung menggunakan SSH milik connector backend. Discovery/Winbox terdeteksi belum membuktikan SSH aktif. Tampilkan kesalahan koneksi aktual; jangan mengganti port menjadi 8291 atau berpura-pura mempunyai akses MAC-Winbox.

### Kontrak eksekusi

Keputusan awal: bangun terminal command terkontrol untuk RouterOS, dengan tampilan terminal yang streaming. Pengguna dapat mengetik perintah RouterOS yang didukung; ini bukan shell PowerShell/Bash komputer host. Jangan menyediakan endpoint exec OS umum.

Jangan sekadar meneruskan byte PTY bebas jika mode read-only masih dijanjikan. Untuk batch perintah, parse/klasifikasikan sebelum dispatch; larang bentuk yang tidak dapat diklasifikasikan, bukan menebak dengan startsWith. Perintah kompleks seperti script, find/subexpression, semicolon, rename alias dan multi-command wajib dinilai menyeluruh. Adaptor command dapat memetakan operasi ke katalog/tool yang sudah aman. Tampilkan keterbatasan command yang belum didukung secara jujur.

Jika tahap lanjutan menambahkan full interactive PTY, buat desain izin dan pengujian terpisah yang benar-benar dapat menegakkan policy; jangan menyebut command runner sebagai terminal Winbox identik. Minimum yang harus selesai dalam scope ini adalah command terminal fungsional dengan output nyata, history, cancel, dan validasi.

- Setiap eksekusi memeriksa autentikasi, ownership, status connector, mode/version live, risiko dan transaksi.
- Read-only hanya mengizinkan command baca yang terklasifikasi; unknown ditolak.
- Mutasi memerlukan Write serta transaksi backend; safe mode dibuka sebelum eksekusi dan diakhiri setelah verifikasi.
- Tidak ada toggle Write baru di header/panel. Arahkan pengguna ke composer untuk mengubah izin.
- Batch mutasi dalam satu submit dianggap satu job/transaksi, dengan urutan aksi tercatat.
- Command lifecycle Safe Mode tidak dapat dipanggil langsung melalui input pengguna atau AI untuk melewati koordinator.
- Command yang tidak dapat di-rollback/ditangani aman harus ditolak dengan alasan; jangan berasumsi semua operasi RouterOS terlindungi Safe Mode.
- Untuk pembatalan, tutup command channel yang tepat dan konfirmasi status; kehilangan transport bukan bukti rollback sukses.
- Tidak boleh reconnect otomatis lalu mengulang command. Reconnect hanya memulihkan koneksi/status/output.
- Serialize eksekusi terhadap router fisik yang sama antara terminal pengguna, agent AI, dan connector alias. Jika router dipakai run lain, tampilkan “Router sedang digunakan”; jangan mengambil alih sesi aktif.
- RouterOS Safe Mode dapat mencakup perubahan dari sesi lain pada router yang sama; karena itu sesi terminal paralel bukan isolasi transaksi. Dasar teknis: [RouterOS Configuration Management](https://manual.mikrotik.com/docs/getting-started/configuration-management/).
- Disconnect, Write OFF, logout, timeout, restart dan penutupan command mutasi harus mengikuti cleanup backend yang teruji. Menutup panel saja tidak otomatis mengklaim command berhenti; UI harus menjelaskan aktivitas yang masih berjalan.

Transport awal dapat memakai POST command + SSE output, sesuai Hono yang sudah ada. Gunakan WebSocket hanya bila fitur input interaktif memerlukannya dan tersedia validasi session/Origin yang benar. Jangan menaruh kredensial atau token session pada URL.

## 14. Terminal RouterOS untuk AI

AI mempunyai adapter eksekusi perintah sendiri yang dibatasi router target run. Gunakan lapisan execution service yang sama dengan terminal pengguna, tetapi actor, activityId, commandId dan output channel terpisah. Sesi/kanal terpisah tidak berarti boleh mengabaikan lock router fisik.

Semua command AI melewati PolicyDispatcher dan klasifikasi yang sama; jangan memberi jalur raw shell yang melewati tool katalog. Kontrol enable/commit/rollback tetap backend-only. Reuse fungsi quote/command builder dalam packages/mikrotik-tools bila cocok.

Command dan hasil AI tampil di timeline “RouterOS terminal · AI”, lengkap chevron, status, output tersanitasi, error dan finalisasi transaksi. Jika AI hanya menulis contoh kode, jangan mencatatnya sebagai command yang dijalankan.

Tidak memberikan AI akses arbitrary ke terminal Windows, file lokal, env atau credential store. Contoh PowerShell pada screenshot merupakan referensi tampilan panel, bukan permintaan membuat remote shell komputer pengguna.

## 15. Perubahan model data dan kontrak API

Nama berikut usulan awal; sesuaikan dengan schema dan pola error repo tanpa menduplikasi tabel.

### Data

| Area | Tambahan minimum |
| --- | --- |
| accounts | id, workspaceId FK existing, username unik, loginAlias unik, displayName, passwordHash, timestamps |
| sessions | id/hash token, accountId, createdAt, expiresAt, revokedAt; cleanup kadaluarsa |
| conversations | pinnedAt nullable, archivedAt nullable, revision untuk CAS bila diperlukan; createdAt existing tetap |
| preferences | akun, theme/sidebar preference bila disinkronkan, autoCompact, threshold, timestamps |
| conversation_summaries | conversationId, version, throughSeq, sourceRevision/hash, summary, model, usage, timestamps |
| compaction_jobs | id, conversationId, sourceRevision, status, reason, summaryVersion, error; idempotency |
| activity_events | actor, scope ids, seq, type, sanitized payload, timestamp, index pagination |
| terminal_sessions/commands | account/workspace, connector/identity, actor, command sanitized, status, transactionId, timeout, output reference |

SQLite migration bersifat additive dan idempotent. Uji DB yang sudah berisi chat/provider/connector terenkripsi; jangan reset DB. Tambahkan indeks yang sesuai dan uniqueness seq dalam scope yang benar. Jika memperkuat seq message, audit/atasi duplikat legacy secara deterministik sebelum menambah unique constraint.

Existing deletedAt tidak otomatis berarti endpoint sudah soft-delete. Audit perilaku delete dan cleanup storage yang sedang berjalan sebelum memutuskan perubahan; permintaan ini tidak mewajibkan trash/restore pesan terhapus.

### API

| Endpoint usulan | Kontrak |
| --- | --- |
| POST /api/auth/login | identifier + password; set cookie; respons profil publik |
| GET /api/auth/me | profil dan status session; tanpa hash/token |
| POST /api/auth/logout | revoke session dan cleanup terkait |
| PATCH /api/profile | profil yang diizinkan, bukan credential router |
| POST /api/auth/password | verifikasi password lama bila halaman perubahan password dibuat |
| GET /api/conversations?archived=&cursor= | daftar, createdAt/updatedAt/pinnedAt/archivedAt, pagination |
| PATCH /api/conversations/:id | title, pin/archive, connection binding tervalidasi; CAS bila perlu |
| GET /api/conversations/:id/export?format=md | stream/download text/markdown milik user |
| POST /api/conversations/:id/compact | idempotency/revision; balikan jobId/status |
| GET /api/conversations/:id/activities | history proses pagination, termasuk compact/manual |
| GET /api/conversations/:id/activities/events | SSE event conversation di luar run, bila dipisahkan |
| POST /api/terminal/sessions | bind connector & conversation; validasi status/ownership |
| POST /api/terminal/sessions/:id/commands | input command; balikan commandId; bukan string exec host |
| GET /api/terminal/commands/:id/events | stream output/status tersanitasi |
| POST /api/terminal/commands/:id/cancel | cancel aktual, bukan perubahan status UI saja |
| DELETE /api/terminal/sessions/:id | tutup terkontrol, reconcile transaksi bila perlu |

Reuse endpoint run/events/transactions existing. Dokumentasikan tipe event dan DTO bersama di packages/shared/src/index.ts. Error 401 untuk session invalid, 403 untuk akses ditolak, 409 untuk konflik state; ikuti envelope AppError. Jangan menulis service baru yang mengakali checks existing.

## 16. Struktur komponen dan file yang disarankan

Frontend:

- Shell: AppShell, ChatSidebar, CollapsedSidebar, ProfileMenu, SettingsLayout.
- Chat: EmptyChatState, ChatHeader, ConversationActionsMenu, ConnectorPicker, ToolActivityList, ToolActivityRow.
- Tampilan output: CodeBlock, TerminalOutput, TerminalPanel.
- Halaman: LoginPage/AuthGate, ProfilePage, AppearancePage, ContextSettingsPage, ArchivedChatsPage.
- Reuse ChatComposer, ChatScreen, ChatPanel, ContextMeter, ConnectorsPanel dan UI primitives; refactor bertahap, jangan duplikasi composer.
- Hooks: auth, conversation actions/export, compaction, terminal session, persistent activities; stabilkan state callback/ref SSE.

Backend:

- Tambah auth/session middleware, auth/profile routes, account service.
- Tambah context builder dan compaction service dekat agent.
- Tambah terminal routes, command classifier/adapter dan execution service.
- Tambah activity repository serta serialisasi event.
- Perluas chat routes, hub, loop, schema/migrations dan shared DTO sesuai kebutuhan terukur.
- Integrasikan wrapper pada dispatcher/coordinator; jangan menyalin state machine transaksi ke terminal.

Hindari App.tsx menjadi tempat seluruh fitur baru. Tiap komponen memegang satu tanggung jawab dan state data tetap melalui query/server.

## 17. Invarian yang tidak boleh regresi

1. Izin Write berasal dari server dan selalu dicek ulang, bukan dari label UI atau ringkasan AI.
2. Connected/identity/credential tervalidasi sebelum begin; signature begin lengkap, policy active hanya setelah sukses.
3. Gagal membuka transaksi menghasilkan mode efektif read-only dan diagnosis yang jujur.
4. Completed + aksi → commit; gagal/cancel → rollback; kosong → rollback empty; unknown tidak diklaim sukses.
5. Lifecycle Safe Mode tidak tersedia untuk model; raw terminal bukan jalur bypass.
6. Tool execution, session dan credentials tidak dibagikan antar pemilik/target.
7. Mengubah mode menginvalidasi live catalog; mode read-only diteruskan ke child; respawn-on-mode-change dipertahankan.
8. Recovery restart tetap disconnect connector dan reset Write. Jangan membuat “tetap Write setelah restart”.
9. Readiness SSH nyata, tidak disimpulkan dari discovery/Winbox.
10. Redaksi berlaku pada log, transcript proses, export, token output stream dan error.
11. Source message dan attachment yang sudah disimpan tidak dihapus saat compact.
12. Idempotency berlaku untuk run, job compact dan command; reconnect tidak mengulangi mutasi.
13. Keberadaan login tidak mengubah ownership workspace lama atau key enkripsi.
14. Semua aksi menu benar-benar tersimpan dan bekerja setelah reload.

## 18. Urutan implementasi dan gerbang selesai

| Fase | Pekerjaan | Syarat selesai |
| --- | --- | --- |
| 0 — Audit/baseline | Baca AGENTS bila ada, cek diff, inventaris komponen dan tes, verifikasi baseline | Catat kondisi sebelum edit dan lindungi perubahan pengguna |
| 1 — Fondasi data/auth | Migrasi additive, akun seed, login/session/API guards, logout | Login kedua identifier berhasil; API tanpa session ditolak; data lama tetap dapat dibuka |
| 2 — Shell/navigasi | Sidebar collapse, profil, settings sidebar, routing | Semua halaman dapat dibuka/back/refresh; pintasan lama dan teks terlarang hilang |
| 3 — Composer/chat bersih | Connector di (+), tambah router returnTo, empty state dan header | Chat umum tanpa router bekerja; router target tidak berganti diam-diam; header mode hilang |
| 4 — Manajemen chat | Rename, export, pin, arsip/restore, tanggal dan pagination | Seluruh aksi persistent, ownership teruji, export lengkap |
| 5 — Proses persisten | Event schema, repository, SSE recovery, panel kode/terminal | Aktivitas nyata bertahan setelah reload; output aman; tidak salah pairing |
| 6 — Compact | Context builder, summary versioning, job background/manual/auto | Model kecil tetap lanjut, pesan utuh, provider failure terkelola, tanpa replay tools |
| 7 — Terminal manual/AI | Command adapter, streaming, locks, cancel, policy/transaksi | Command nyata ke test router terverifikasi; race user/AI tidak melanggar pengaman |
| 8 — Polish/validasi | Responsive, tema, accessibility, docs, regresi lengkap | Semua test hijau, screenshot dibandingkan, batas uji nyata dilaporkan |

Kerjakan per fase sampai end-to-end berfungsi. Jangan berhenti pada UI mock jika endpoint belum dibuat. Agent boleh memilih urutan teknis internal, tetapi jangan menampilkan terminal mutasi sebelum pengaman eksekusinya siap.

## 19. Test wajib

### Backend dan integrasi

- Login username maupun alias, password salah, rate limit, cookie/session expiry, logout, CSRF/Origin dan API tanpa session.
- Provision akun dua kali tidak mengubah password/data; akun terhubung workspace lama dan bisa mendekripsi provider/connector existing.
- Export semua pesan melewati limit pagination, fenced code nested, judul Unicode/nama file aman, redaksi credential, attachment metadata, user lain ditolak.
- Pin/archive/restore/rename persistent; arsip tidak muncul di daftar aktif; createdAt tidak berubah.
- Compact manual/auto, concurrent jobs, duplicate request, summary CAS, switch model, huge attachment/tool output, cancel/restart/failure.
- Pastikan request provider berikutnya benar-benar berisi summary + recent turns utuh dan tanpa history lama duplikat; bukan sekadar status “compacted” di DB.
- Sequence event/message unik dan pair tool call/result terjaga.
- Terminal command read sukses, write saat read-only ditolak, unknown/multi-command/script bypass ditolak, target host override ditolak.
- Write dengan begin sukses, commit/rollback/unknown, Write OFF/disconnect/logout/cancel saat command berlangsung.
- Chat AI dan terminal pengguna bersaing pada router fisik sama; konektor alias tidak membuat lock bypass.
- SSE reconnect/reload tidak menggandakan output dan tidak re-execute command.
- Error SSH refused/timeout/auth-failed tidak dipalsukan menjadi connected.
- Redaksi output streaming yang secret-nya terpotong antar chunk; sanitasi ANSI/OSC/HTML.
- Gunakan DB in-memory, dispatcher dan coordinator nyata dengan transport/provider stub terkontrol. Jangan menyederhanakan signature produksi untuk membuat tes lulus.

### Frontend

- Login redirect, logout membersihkan cache, profil menu, tema terang/gelap/sistem.
- Sidebar expanded/collapsed/mobile dengan keyboard, focus restoration dan tooltip.
- Composer (+) menampilkan Connector/Tambah router/Write, tidak ada pilihan Tanpa router/Dokumentasi saja.
- Draft/attachment/connector pilihan bertahan saat menambah router di pengaturan.
- Chat kosong tanpa header/hero/kartu; header muncul setelah pesan pertama dan transparan.
- Aksi titik tiga dari header dan sidebar konsisten, export menghasilkan file, pin/archive/rename persistent.
- Tanggal dibuat, grouping recency, pagination, pencarian, arsip/restore.
- Activity chevron terbuka/tertutup; tool berulang/parallel dipasangkan menurut id.
- CodeBlock berbeda dari TerminalOutput; command contoh tidak dikira pernah dieksekusi.
- Compact progress nyata dan cancel/fail terlihat; input draft tidak hilang.
- Terminal opening/resizing/close, command pending, cancel, disabled saat disconnected, status final yang jujur.

### Verifikasi perintah

~~~powershell
bun run typecheck
bun test apps/api packages
bun run --cwd apps/web test
bun run lint
bun run build
~~~

Jalankan E2E melalui tooling Playwright yang benar-benar tersedia setelah memeriksa konfigurasi/script repo. Jangan mengklaim sebuah script E2E tersedia hanya karena nama pernah muncul pada dokumentasi lama.

### Verifikasi visual dan manual

Viewport minimal 390×844, 768×1024, 1440×900; periksa light/dark, menu profil, settings, sidebar collapsed, chat baru, chat berisi, activity expanded, terminal dan login. Tidak boleh ada overflow horizontal halaman; hanya blok kode/terminal yang boleh scroll horizontal.

Gunakan router uji yang disetujui untuk eksekusi nyata. Verifikasi command baca, mutasi kecil yang dapat dibalik, cancel, disconnect dan Write OFF. Jika tidak ada perangkat/provider uji, laporkan batas itu; tes transport simulasi tidak membuktikan perubahan nyata pada router.

## 20. Checklist penerimaan produk

- [ ] Connector ada dalam menu (+), dengan ikon tambah yang menuju pengaturan router.
- [ ] Tidak ada pilihan “Tanpa router” atau “Dokumentasi saja”; chat umum tetap berfungsi.
- [ ] Header tidak berisi Mode: Read-Only, toggle Write atau pemilih router duplikat.
- [ ] Seluruh halaman konfigurasi berada dalam sidebar Pengaturan.
- [ ] Sidebar chat tidak mempunyai pintasan Connector Router/Provider AI.
- [ ] Teks Provider & Safe Mode dan Workspace lokal di sidebar hilang.
- [ ] Profil bawah sidebar mempunyai menu Profil/Pengaturan/tema/Bantuan/Keluar.
- [ ] Login akun yang diminta berfungsi dan API benar-benar terlindungi.
- [ ] Sidebar dapat dibuka/ditutup dan nyaman pada mobile.
- [ ] Menu chat berisi export .md, rename, delete, pin, archive; arsip dapat dipulihkan.
- [ ] Tanggal pembuatan chat tampil, metadata disimpan server.
- [ ] Chat baru bersih tanpa hero/kartu saran/header percakapan.
- [ ] Setelah pesan pertama, header transparan dengan Terminal/Export/menu muncul.
- [ ] Compact manual/otomatis bekerja di backend, terlihat di timeline dan percakapan dapat lanjut.
- [ ] Semua aktivitas tool yang observable tampil expandable dan pulih setelah reload.
- [ ] Panel kode dibedakan dari terminal hasil eksekusi.
- [ ] Terminal pengguna menjalankan perintah RouterOS yang didukung dengan output nyata.
- [ ] Terminal AI tampil sebagai proses dan mengikuti policy/transaksi yang sama.
- [ ] Tidak ada bypass Write/Safe Mode, credential leak, atau command replay.
- [ ] Semua tes wajib dan build lulus; hasil uji perangkat nyata dibedakan dari simulasi.

## 21. Laporan akhir yang diminta dari AI coding

Laporkan file yang diubah per fitur, migrasi yang ditambahkan, screenshot visual, hasil perintah verifikasi, hasil uji backend/terminal/compact, serta batas yang belum dapat diuji nyata. Sertakan cara menjalankan aplikasi dan login awal. Jangan menyatakan pekerjaan selesai hanya karena layout sudah mirip referensi.

Rencana ini tidak meminta deployment, publikasi npm, penghapusan data existing, reset router, atau perubahan jaringan/SSH pengguna.

