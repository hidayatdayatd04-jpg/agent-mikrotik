import type { Database } from "../../db";
import type { ConnectorService } from "../connector";
import type { sshExec } from "../ssh-exec";

export interface ConfigBackupDTO {
  id: string;
  connectionId: string;
  name: string;
  type: "export_text" | "binary_backup";
  routerIdentity: string | null;
  rosVersion: string | null;
  boardName: string | null;
  sizeBytes: number;
  status: string;
  createdBy: string;
  errorMessage: string | null;
  createdAt: string;
}

/** Konteks service yang dibawa antar modul (pengganti closure factory). */
export interface BackupCtx {
  db: Database;
  connectors: Pick<ConnectorService, "requireOwned" | "decryptCredential">;
  execFn: typeof sshExec;
}
