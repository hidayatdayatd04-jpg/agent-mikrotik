import { Network, Globe, Server, Layers, Plug, User } from "@/components/icons";

export const KIND = {
  gateway: { label: "Gateway", icon: Globe },
  router: { label: "Router", icon: Server },
  interface: { label: "Interface", icon: Plug },
  bridge: { label: "Bridge", icon: Network },
  vlan: { label: "VLAN", icon: Layers },
  subnet: { label: "Subnet", icon: Globe },
  client: { label: "Klien", icon: User },
};
export const SOURCE = {
  configuration: "Konfigurasi",
  dhcp: "DHCP",
  arp: "ARP",
  neighbor: "Neighbor",
  inferred: "Inferensi",
};
export const STATUS = { online: "Online", offline: "Offline", unknown: "Tidak diketahui" };

export const DETAIL_LABELS: Record<string, string> = {
  identity: "Identitas",
  version: "Versi RouterOS / perangkat",
  uptime: "Uptime",
  parent: "Parent interface",
  type: "Tipe",
  mtu: "MTU",
  "vlan-filtering": "VLAN filtering",
  "free-memory": "Memori bebas",
  "total-memory": "Total memori",
  "board-name": "Board",
  "management-ip": "IP manajemen",
  "dhcp-status": "Status DHCP lease",
  "dhcp-server": "DHCP server",
  "expires-after": "Lease kedaluwarsa dalam",
  "last-seen": "Terakhir terlihat (DHCP)",
  "detected-client-records": "Record klien terdeteksi",
  "clients-arp-neighbor": "Klien dengan ARP / neighbor",
  "clients-dhcp-only (inferred)": "Klien DHCP saja (inferensi)",
  "router-addresses": "Alamat router / kandidat gateway lokal",
  "router-address": "Alamat router",
  "route-active": "Default route aktif",
  "route-disabled": "Route disabled",
  "routing-table": "Tabel routing",
  "attachment-note": "Catatan hubungan",
};
