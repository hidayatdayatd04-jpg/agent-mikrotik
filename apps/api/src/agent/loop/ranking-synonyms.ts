/**
 * Sinonim Indonesia → Inggris untuk pencocokan tool. Katalog tool berbahasa
 * Inggris, sedangkan pengguna bertanya dalam Bahasa Indonesia — tanpa peta
 * ini, kueri seperti "tampilkan suhu" tidak pernah cocok dengan tool
 * temperature/health dan tool yang tepat terbuang dari daftar.
 */
const ID_TOOL_SYNONYMS: Record<string, string[]> = {
  tampilkan: ["show", "print", "list", "get"],
  lihat: ["show", "print", "monitor"],
  cek: ["check", "get", "monitor", "print"],
  periksa: ["check", "monitor", "verify"],
  daftar: ["list"],
  tambah: ["add", "create"],
  buat: ["add", "create"],
  hapus: ["remove", "delete"],
  ubah: ["set", "update"],
  ganti: ["set", "change"],
  matikan: ["disable", "shutdown"],
  nyalakan: ["enable"],
  nyala: ["running", "active", "enabled"],
  mati: ["disabled", "down", "offline"],
  suhu: ["temperature", "thermal", "health"],
  kecepatan: ["speed", "bandwidth", "rate"],
  klien: ["client", "lease", "dhcp", "host"],
  sandi: ["password"],
  pengguna: ["user"],
  jaringan: ["network"],
  nirkabel: ["wireless", "wifi"],
  kabel: ["ethernet", "interface"],
  rute: ["route"],
  jembatan: ["bridge"],
  alamat: ["address"],
  ulang: ["reboot", "restart"],
  cadangan: ["backup", "export"],
  pulihkan: ["restore", "import"],
  batas: ["limit", "queue", "max"],
  antrean: ["queue"],
  sertifikat: ["certificate"],
  waktu: ["time", "clock", "ntp"],
  skrip: ["script"],
  jadwal: ["scheduler"],
  paket: ["package"],
  layanan: ["service"],
  tetangga: ["neighbor"],
  terowongan: ["tunnel", "vpn"],
  pantau: ["monitor", "traffic"],
  blokir: ["drop", "block", "filter", "firewall"],
  izinkan: ["accept", "allow", "enable"],
  internet: ["internet", "wan", "gateway", "route", "dns", "ping"],
  lambat: ["slow", "speed", "bandwidth", "queue"],
  putus: ["disconnect", "down", "timeout", "unreachable"],
  tersambung: ["connected", "running", "reachable"],
};

/** Kata kunci kueri (panjang ≥3) + ekspansi sinonim Inggris. */
export function extractQueryKeywords(userText: string): Set<string> {
  const base = userText
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
  const out = new Set(base);
  for (const w of base) {
    const syns = ID_TOOL_SYNONYMS[w];
    if (syns) for (const s of syns) if (s.length >= 3) out.add(s);
  }
  return out;
}
