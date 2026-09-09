import { formatItemNames } from "./verification-names";

export interface NarrativeFlags {
  isRemove: boolean;
  isAdd: boolean;
  isDisable: boolean;
  isEnable: boolean;
}

export function buildVlanNarrative(flags: NarrativeFlags, targets: string[], activeNames: string[]): string {
  let narrative = "Saya telah memverifikasi status interface VLAN di router setelah perubahan diterapkan.\n\n";
  if (flags.isRemove) {
    const targetStr = targets.length > 0 ? formatItemNames(targets) : "target VLAN";
    narrative += `Berdasarkan hasil pembacaan langsung dari router, interface ${targetStr} sudah berhasil dihapus dari daftar interface.`;
    if (activeNames.length > 0) {
      narrative += ` Saat ini interface VLAN yang aktif tersisa adalah ${formatItemNames(activeNames)}.`;
    }
  } else if (flags.isAdd) {
    const targetStr = targets.length > 0 ? formatItemNames(targets) : "VLAN";
    narrative += `Berdasarkan hasil pembacaan langsung dari router, interface ${targetStr} sudah berhasil dibuat dan berstatus aktif pada router.`;
  } else if (flags.isDisable) {
    const targetStr = targets.length > 0 ? formatItemNames(targets) : "VLAN";
    narrative += `Berdasarkan hasil pembacaan langsung dari router, interface ${targetStr} sudah berhasil dinonaktifkan.`;
  } else if (flags.isEnable) {
    const targetStr = targets.length > 0 ? formatItemNames(targets) : "VLAN";
    narrative += `Berdasarkan hasil pembacaan langsung dari router, interface ${targetStr} sudah berhasil diaktifkan dan berstatus aktif pada router.`;
  } else {
    narrative += `Berdasarkan hasil pembacaan langsung dari router, konfigurasi interface VLAN telah berhasil diperbarui dan diterapkan ke router.`;
  }
  return narrative;
}

export function buildInterfaceNarrative(flags: NarrativeFlags, targets: string[]): string {
  let narrative = "Saya telah memverifikasi status interface di router setelah perubahan diterapkan.\n\n";
  if (flags.isRemove) {
    const targetStr = targets.length > 0 ? formatItemNames(targets) : "target interface";
    narrative += `Berdasarkan hasil pembacaan langsung dari router, interface ${targetStr} sudah berhasil dihapus dari daftar interface.`;
  } else if (flags.isDisable) {
    const targetStr = targets.length > 0 ? formatItemNames(targets) : "interface";
    narrative += `Berdasarkan hasil pembacaan langsung dari router, interface ${targetStr} sudah berhasil dinonaktifkan.`;
  } else if (flags.isEnable) {
    const targetStr = targets.length > 0 ? formatItemNames(targets) : "interface";
    narrative += `Berdasarkan hasil pembacaan langsung dari router, interface ${targetStr} sudah berhasil diaktifkan dan berstatus aktif pada router.`;
  } else {
    const targetStr = targets.length > 0 ? formatItemNames(targets) : "interface";
    narrative += `Berdasarkan hasil pembacaan langsung dari router, interface ${targetStr} sudah berhasil diterapkan dan berstatus aktif pada router.`;
  }
  return narrative;
}

export function buildAddressNarrative(targets: string[]): string {
  const targetStr = targets.length > 0 ? formatItemNames(targets) : "";
  return `Saya telah memverifikasi status IP address di router setelah perubahan diterapkan.\n\nBerdasarkan hasil pembacaan langsung dari router, konfigurasi IP address ${targetStr ? `${targetStr} ` : ""}sudah berhasil diterapkan dan aktif pada router.`;
}

export function buildFirewallNarrative(): string {
  return `Saya telah memverifikasi aturan firewall di router setelah perubahan diterapkan.\n\nBerdasarkan hasil pembacaan langsung dari router, aturan firewall sudah berhasil diterapkan dan aktif pada tabel konfigurasi router.`;
}

export function buildFallbackNarrative(summary: string): string {
  return `Saya telah memverifikasi status konfigurasi di router setelah perubahan diterapkan.\n\nBerdasarkan hasil pembacaan langsung dari router, perubahan konfigurasi "${summary}" sudah berhasil diterapkan dan terverifikasi aktif.`;
}
