import type { Database } from "../../db";
import type { KeyRing } from "../../lib/crypto";
import type { TargetPolicy } from "../target-policy";
import type { SshProbeOptions, SshProbeResult } from "../ssh-probe";

export interface ConnectorServiceDeps {
  db: Database;
  keyRing: KeyRing;
  targetPolicy: TargetPolicy;
  sshTimeoutMs: number;
  log: (msg: string, data?: unknown) => void;
  /** Injectable for tests; defaults to the real ssh2 probe. */
  probe?: (opts: SshProbeOptions) => Promise<SshProbeResult>;
}

/** Konteks service yang dibawa antar modul (pengganti closure factory). */
export interface ConnectorCtx {
  db: Database;
  keyRing: KeyRing;
  targetPolicy: TargetPolicy;
  sshTimeoutMs: number;
  log: (msg: string, data?: unknown) => void;
  probeFn: (opts: SshProbeOptions) => Promise<SshProbeResult>;
}
