# Review penerapan perbaikan agent

Tanggal: 7 September 2026. Acuan: `walkthrough.md` dan diff implementasi saat review.

Kesimpulan: sebagian perbaikan bekerja, tetapi belum layak dinyatakan selesai. Ada regresi pada pembacaan di connector Write dan penyimpanan riwayat saat settlement gagal. Penjelasan error setelah output parsial juga belum terjamin.

## Verifikasi yang dijalankan

| Pemeriksaan | Hasil |
|---|---|
| `bun test apps/api packages` | 290 pass, 0 fail, 35 file |
| `bun run --cwd apps/web test` | 44 pass, 0 fail, 8 file |
| `bun run typecheck` | Exit 0 |
| `bun tooling/audit-agent-flow.ts` | Empat skenario menunjukkan perbaikan sesuai walkthrough |
| `bun .local-smoke/review-followup.ts` | Reproduksi tambahan menemukan masalah di bawah |

Semua simulasi tambahan menggunakan SQLite in-memory, provider palsu, dan connector/transaksi palsu. Tidak ada request AI berbayar, akses router nyata, atau perubahan implementasi produksi dalam review ini. Pengujian UI yang dilakukan adalah suite komponen yang tersedia; bukan verifikasi visual interaktif seluruh aplikasi.

## Temuan yang perlu diperbaiki

### 1. P1 — Semua tool baca ditolak untuk permintaan read-only pada connector Write

Lokasi: `apps/api/src/routes/chat.ts:663`, terkait `apps/api/src/policies/dispatcher.ts:108`.

Route mengisi `policy.mode = effectiveMode`, yaitu read-only pada permintaan inspeksi. Dispatcher tetap membandingkan `snapshot.mode` dengan mode connector aktual sebelum memeriksa `runMode`. Jika connector Write, ia langsung mengembalikan POLICY_CHANGED, walaupun mode connector sama sekali tidak berubah.

Bukti route + loop + dispatcher nyata dengan fixture: prompt `hanya baca interface` menghasilkan `began: 0`, `reads: 0`, dan kegagalan `mt:list_interfaces` berkode POLICY_CHANGED. Artinya transaksi memang tidak dibuka, tetapi pembacaan yang diminta juga tidak bekerja.

Perbaikan: simpan mode connector asli pada snapshot CAS; gunakan runMode hanya sebagai pembatas operasi. Pemilihan katalog loop juga harus memakai izin efektif per-run, bukan kembali mengambil katalog mode connector. Izin efektif merupakan irisan izin connector dan izin run; runMode tidak boleh meningkatkan izin connector read-only menjadi Write.

Regresi wajib: connector Write + prompt lab asli → tool baca berhasil, mutasi ditolak, transaksi tidak dibuka. Toggle connector yang benar-benar berubah tetap memicu invalidasi policy.

### 2. P1 — Kegagalan settlement menandai seluruh riwayat assistant sebagai gagal

Lokasi: `apps/api/src/routes/chat.ts:714`.

UPDATE pesan hanya difilter berdasarkan conversationId dan role assistant. Tidak ada pembatas runId/messageId untuk jawaban run yang sedang diselesaikan.

Bukti: percakapan fixture memiliki satu jawaban lama berstatus complete dan jawaban run baru. Setelah commit run baru melempar error, kedua jawaban menjadi failed. Karena loop mengabaikan pesan failed saat membangun history, dampaknya juga menghilangkan konteks jawaban lama yang sebenarnya berhasil.

Perbaikan: perbarui hanya pesan assistant milik run terkait, simpan alasan settlement, dan berikan penjelasan hasil perubahan yang belum pasti. Status database juga seharusnya tetap nonterminal sampai settlement selesai agar polling UI tidak lebih dahulu menyatakan selesai.

### 3. P1 — Kegagalan setelah teks parsial masih tanpa penjelasan

Lokasi: `apps/api/src/agent/loop.ts:530`.

`finalizeRun()` membentuk pesan kegagalan hanya jika seluruh assistantText kosong. Teks pembuka atau jawaban parsial membuat blok penjelasan dilewati. Ini juga mengurangi perilaku jalur exception lama yang sebelumnya menambahkan penjelasan sesudah teks parsial.

Bukti: provider mengeluarkan `Saya akan memeriksa.` lalu melempar error. Run menjadi failed, tetapi teks tersimpan hanya `Saya akan memeriksa.`. Alasan error hanya ada pada terminal event, tidak menjadi pesan chat.

Perbaikan: selalu tambahkan penutup error/cancel yang sesuai untuk hasil non-completed, sambil mempertahankan teks parsial. Bedakan ringkasan tool berhasil, tool ditolak, dan tool gagal; jangan memberi judul hasil berhasil untuk semuanya.

### 4. P1 — Respons akhir kosong/terpotong masih dapat dianggap selesai

Lokasi: `apps/api/src/agent/loop.ts:688`, terkait penanganan event done sekitar baris 681.

Kondisi EMPTY_RESPONSE mensyaratkan stepText dan seluruh assistantText kosong sekaligus. Bila giliran sebelumnya memberi kalimat pembuka lalu memanggil tool, giliran final yang kosong lolos sebagai completed. `finishReason` juga masih tidak diperiksa.

Bukti: preamble → tool → giliran kosong menghasilkan completed dengan teks `Saya akan memeriksa.`. Fixture `finishReason: length` juga menghasilkan completed walaupun output terpotong.

Perbaikan: validasi giliran final secara terpisah dari commentary/preamble. Tangani finish reason terpotong/tidak lengkap secara eksplisit; jangan memakai keberadaan teks pada giliran terdahulu sebagai bukti tugas selesai.

### 5. P1 — Transaksi belum benar-benar lazy; klasifikasi inspeksi masih salah

Lokasi: `apps/api/src/routes/chat.ts:593`, `apps/api/src/agent/intent.ts:31`, `apps/api/src/agent/loop.ts:800`.

Blok pembukaan transaksi lama masih berjalan sebelum loop untuk setiap permintaan yang tidak diklasifikasikan read-only. Callback ensureTransaction ditambahkan, tetapi mode run dibuat read-only bila transaksi belum aktif. Dalam alur route normal callback itu tidak menggantikan pembukaan awal seperti klaim walkthrough.

Klasifikasi yang diuji langsung:

| Prompt | isReadOnlyIntent saat ini | Masalah |
|---|---|---|
| `cek konfigurasi router` | false | Kata konfigurasi dianggap mutasi sebelum inspeksi dipertimbangkan |
| `Jangan melakukan konfigurasi langsung melalui MCP, API, SSH, atau tool write apa pun.` | false | Kalimat larangan ini sendiri tidak dikenali; prompt lab lengkap kebetulan memiliki kata read-only lain |
| `tambahkan rule firewall, jangan hapus aturan lama` | true | Larangan menghapus menyempitkan izin secara berlebihan hingga melarang penambahan yang diminta |

Pencatatan transaksi juga masih menghitung setiap tool pada mode Write tanpa memeriksa risiko tool efektif, termasuk pencarian/baca/gagal/cache.

Perbaikan: hilangkan pembukaan transaksi sebelum kebutuhan mutasi diketahui, pertahankan izin mutasi yang memang diotorisasi selama transaksi belum dibuka, dan buka transaksi setelah validasi target/argumen/izin. Perbaiki pemisahan aksi yang diminta dan batas pengguna. Hitung hanya aksi mutasi yang relevan dan benar-benar dieksekusi.

### 6. P1 — Deadline tetap hanya diperiksa antar-giliran

Lokasi: `apps/api/src/agent/loop.ts:647`.

Belum ada timer deadline yang meng-abort antrean/provider/tool. Stream yang mulai sebelum deadline dapat menunggu melewatinya. Jika akhirnya menghasilkan teks final, loop keluar tanpa mengecek waktu lagi dan melaporkan completed.

Bukti clock fixture: deadline 1.000 ms, provider selesai setelah clock digeser 2.000 ms → completed. Konflik limiter empat request/menit dengan deadline 120 detik dari audit sebelumnya juga belum diselesaikan oleh perubahan ini.

Perbaikan: propagasikan sisa deadline ke antrean dan request, batasi eksekusi tool, dan sisakan waktu finalisasi/settlement. Tambahkan status menunggu provider yang didukung telemetry, serta kurangi perjalanan model untuk pembacaan independen.

### 7. P2 — Injeksi hasil discovery dapat melewati batas ukuran katalog

Lokasi: `apps/api/src/agent/loop.ts:783`.

Setiap nama tool yang muncul sebagai substring hasil discovery ditambahkan ke providerTools dengan push. Tidak ada seleksi ulang, batas jumlah, atau budget schema setelah penambahan. Batas awal 48 tool tidak berlaku lagi. Kemunculan nama dalam prosa/deskripsi juga dapat memuat tool yang bukan kandidat yang dipilih.

Perbaikan: identifikasi kandidat discovery secara terstruktur atau parsing format katalog yang pasti, muat hanya kandidat yang diperlukan, dan tegakkan batas token/jumlah pada setiap request. Ukur penggunaan dengan prompt lab asli; lulus unit test tidak membuktikan pengurangan dari 305.396 input token.

## Bagian yang sudah membaik dan batas klaim

- Empat reproduksi awal sudah menunjukkan penjelasan saat jawaban benar-benar kosong, kegagalan saat maxSteps habis, serta status cache gagal yang tetap gagal.
- Timeline sekarang mengelompokkan tool berurutan menjadi satu grup; UI tidak lagi selalu mengirim array satu tool ke setiap grup.
- Tombol Coba Lagi tersedia untuk pesan gagal kosong. Namun masih mengirim ulang prompt, bukan melanjutkan hasil checkpoint. Tombol Periksa di Terminal selalu memakai `/system resource print`, bukan pemeriksaan yang disesuaikan dengan kegagalan.
- lastRequestInputTokens/lastRequestOutputTokens sudah dicatat. Tetapi ContextMeter masih kembali ke total kumulatif jika field baru tidak tersedia atau bernilai nol, sehingga record lama masih bisa menunjukkan persentase context window keliru.
- Panel proses masih defaultOpen, gaya detail terminal dan status headline kegagalan per fase masih ada. Ini perbaikan pengelompokan, belum seluruh rancangan UX dalam audit.
- Budget token per-run, pemulihan checkpoint persisten, auto-compaction yang tersambung, dan state finalizing belum diterapkan pada perubahan yang direview.

## Keputusan review

Klaim hasil 290/44 tes dan typecheck di walkthrough terbukti benar. Klaim bahwa seluruh masalah arsitektur dan alur sudah selesai belum benar. Prioritas berikutnya adalah temuan 1–4, lalu transaksi/deadline dan pembuktian efisiensi. Tambahkan pengujian untuk jalur gabungan route + dispatcher + loop, output parsial, dan percakapan dengan jawaban lama; empat reproduksi awal terlalu sempit untuk memvalidasi seluruh perbaikan.
