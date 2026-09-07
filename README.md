# MikroTik Agent

Chat AI untuk router MikroTik, berjalan di laptop dengan Bun. Tanpa akun atau login. Web dan API berjalan bersama; data tersimpan sebagai file lokal.

## Instalasi

Setelah paket dipublikasikan ke registry npm:

```sh
bun add -g mikrotik-agent
mikrotik-agent run
```

Buka **http://localhost:3000**. CLI membuat database, key enkripsi, dan folder lampiran otomatis. Dokumentasi RouterOS diunduh sekali saat run pertama (memerlukan internet). Tidak perlu Docker, database server, atau .env.

**Paket belum dipublikasikan oleh perubahan ini.** Sebelum publikasi, gunakan paket lokal:

```sh
bun install
bun run build
bun pm pack --ignore-scripts --filename mikrotik-agent-0.1.0.tgz
bun add -g ./mikrotik-agent-0.1.0.tgz
mikrotik-agent run
```

Alternatif source setelah build: `bun run start`. Bun >=1.3.3 harus tersedia di PATH. Instalasi global mengikuti [dokumentasi Bun](https://bun.com/docs/pm/cli/add#global).

Pada Windows, pastikan `bun.exe` tersedia di PATH; shim CLI global tidak dapat memakai wrapper PowerShell/npm saja.

## Pemakaian

1. Isi provider, API key, dan model melalui **Provider AI** (Gemini, OpenRouter, atau endpoint OpenAI-compatible).
2. Tambahkan router melalui **Connector**. SSH diuji sebelum kredensial disimpan.
3. Buat chat dan pilih router. Mode awal Read-Only; Write melalui pengaman backend dan Safe Mode.
4. Ctrl+C menghentikan aplikasi.

Tanpa provider, respons memakai mock berlabel, bukan AI nyata.

```sh
mikrotik-agent run --port 3100
mikrotik-agent run --data-dir "D:/Data/MikroTik"
mikrotik-agent --help
```

## Data lokal

Default: `~/.mikrotik-agent` atau `C:/Users/<nama>/.mikrotik-agent`.

| File/folder | Isi |
| --- | --- |
| agent.sqlite | Chat, pesan, connector, provider, audit, transaksi |
| credential.key | Key enkripsi password router dan API key |
| attachments/ | Lampiran lokal |
| corpus/ros-help.db | Dokumentasi RouterOS |
| runtime.lock | Pencegah dua CLI memakai data bersamaan |

Browser memakai localStorage hanya untuk preferensi tampilan. Backup seluruh folder setelah aplikasi berhenti; database dan key harus dipulihkan bersama.

## Development dan verifikasi

```sh
bun install
bun run build
bun run start
# Setelah stop dan provisioning pertama selesai:
bun run dev
bun run typecheck
bun run lint
bun test apps/api packages
bun run test:ui
```

Development: web :3000, API :3001. Tes data memakai SQLite in-memory; tes MCP menjalankan dependency asli. Mutasi pada RouterOS fisik dan provider AI nyata masih memerlukan perangkat/API key pengguna.

Lihat [plan.md](plan.md), [setup](docs/setup.md), [keamanan](docs/security.md), [recovery](docs/recovery.md), dan [cakupan tool](docs/tool-coverage.md).
