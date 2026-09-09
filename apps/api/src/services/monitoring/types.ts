export interface MonitoringLiveData {
  identity: string | null;
  model: string | null;
  rosVersion: string | null;
  architecture: string | null;
  uptime: string | null;
  cpuLoad: number | null;
  cpuCount: number | null;
  freeMemory: number | null;
  totalMemory: number | null;
  memoryPercent: number | null;
  temperature: number | null;
  routerOnline: boolean;
  internetOnline: boolean | null;
  interfaces: InterfaceInfo[];
  connectedClients: number | null;
  collectedAt: string;
}

export interface InterfaceInfo {
  name: string;
  type: string;
  status: string; // up | down | disabled
  rxBytes: number;
  txBytes: number;
  rxRate: string | null;
  txRate: string | null;
  macAddress: string | null;
}

export interface RouterInfo {
  identity?: string | null;
  rosVersion?: string | null;
  boardName?: string | null;
  architecture?: string | null;
}
