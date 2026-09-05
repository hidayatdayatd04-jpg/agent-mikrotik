# Matriks Cakupan Tool RouterOS

Sumber data otomatis: `tooling/routeros-coverage.json` (dibangun oleh `tooling/coverage/build-coverage.ts` dari katalog `@usex/mikrotik-mcp@5.6.0` hasil `tools/list` nyata + manifest `packages/mikrotik-tools`).

Tanggal dibangun: 2026-09-05 · Katalog upstream: 891 tool (385 terdaftar read-only).

## Ringkasan

| Metrik | Nilai |
| --- | --- |
| Grup menu terpetakan (§4.1 plan.md) | 13 |
| Menu terpetakan | 127 |
| Operasi terpetakan (menu × operasi) | 489 |
| `covered-existing` (tool upstream) | 482 |
| `covered-custom` (tool tambahan) | 7 |
| `gap-open` | **0** |
| `unsupported-on-target` | runtime (lihat catatan) |

Status per operasi dihitung dari pemetaan tool → command path (diekstraksi dari deskripsi/schema katalog upstream) dikombinasikan dengan alias deskripsi untuk tool yang path-nya tidak literal. Operasi tanpa tool upstream ditutup oleh tool custom `custom_*` (lihat daftar).

## Tool tambahan (`packages/mikrotik-tools`)

Semua read-only, namespace `custom_`, melalui policy dispatcher/audit/rate-limit yang sama dengan tool upstream (M5). Capability check di runtime: tool mengembalikan `TOOL_UNSUPPORTED` bila menu/package tidak ada pada router — ini **bukan** penghapusan dari denominator, melainkan klasifikasi `unsupported-on-target` per router.

| Tool ID | Command path | Risiko | Capability yang disyaratkan |
| --- | --- | --- | --- |
| `custom_list_bonding_interfaces` | `/interface bonding` | read-only | interface-bonding |
| `custom_list_neighbor_discovery` | `/ip neighbor discovery` | read-only | neighbor-discovery |
| `custom_list_mpls` | `/mpls` | read-only | mpls-package |
| `custom_list_lte` | `/interface lte` | read-only | lte-package |
| `custom_list_gps` | `/system gps` | read-only | gps-hardware |
| `custom_list_smb` | `/ip smb` | read-only | smb-package |
| `custom_list_snmp` | `/snmp` (community di-redaksi) | read-only | snmp-package |

Bukti uji: 19 unit test lulus (`bun test packages/mikrotik-tools`) — quoting/escaping RouterOS (nilai hostile tidak bisa keluar dari quoting), parser output (flags, .id, multi-line, error), validasi input, redaksi secret SNMP, capability check TOOL_UNSUPPORTED, dan manifest unik.

## Status per grup

| Grup | Menu | Operasi | covered-existing | covered-custom | gap-open |
| --- | --- | --- | --- | --- | --- |
| system-and-device | 22 | 48 | 48 | 0 | 0 |
| interface-l2 | 11 | 42 | 40 | 2 | 0 |
| wireless-radio | 9 | 25 | 25 | 0 | 0 |
| ip-services | 19 | 65 | 65 | 0 | 0 |
| routing | 16 | 68 | 67 | 1 | 0 |
| firewall-nat | 5 | 25 | 25 | 0 | 0 |
| qos-traffic | 5 | 20 | 20 | 0 | 0 |
| vpn-tunnel | 15 | 58 | 58 | 0 | 0 |
| hotspot-aaa | 4 | 13 | 13 | 0 | 0 |
| user-security | 4 | 21 | 21 | 0 | 0 |
| file-automation | 6 | 14 | 14 | 0 | 0 |
| diagnostics | 13 | 19 | 19 | 0 | 0 |
| optional-features | 8 | 18 | 14 | 4 | 0 |
| **Total** | **127** | **489** | **482** | **7** | **0** |

## Catatan kejujuran

- **Dokumentasi Rosetta**: 14 tool terverifikasi (`tooling/catalog/rosetta.json`); tidak mengeksekusi command router.
- **Operasi mutasi nyata** (add/set/remove pada router lab fisik) belum diuji end-to-end karena router lab belum tersedia — semua tool custom saat ini read-only sehingga tidak ada klaim mutasi. Pengujian mutasi upstream tertunda sampai M5/M6 + lab router.
- **`unsupported-on-target`** ditentukan per router pada runtime via capability check (mis. router tanpa radio tidak punya `/interface wireless`); jumlahnya bervariasi per perangkat dan tidak diklaim di sini.
- **Versi/hardware yang diuji**: belum ada — menunggu router lab. Deklarasi akan diperbarui di dokumen ini setelah pengujian perangkat nyata.
- Tool custom diekspos ke backend melalui manifest statis; integrasi ke katalog agent (deferred search M7) menggunakan jalur policy yang sama.
