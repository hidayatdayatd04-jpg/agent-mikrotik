export interface DiscoveredDevice {
  ip: string;
  mac: string;
  identity: string;
  version: string;
  platform: string;
  board: string;
  interface: string;
  ipv4: string;
  uptimeSeconds?: number;
  sshAvailable: boolean;
}
