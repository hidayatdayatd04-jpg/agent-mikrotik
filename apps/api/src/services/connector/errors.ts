import { AppError } from "../../lib/errors";
import type { ApiErrorCode } from "@shared/index";
import type { SshProbeResult } from "../ssh-probe";

export function targetError(reason: string): AppError {
  const messages: Record<string, string> = {
    loopback: "Alamat loopback tidak diizinkan sebagai target router.",
    "link-local": "Alamat link-local tidak diizinkan.",
    multicast: "Alamat multicast tidak diizinkan.",
    metadata: "Alamat metadata cloud tidak diizinkan.",
    "not-in-allowlist": "Alamat router tidak berada dalam daftar jaringan yang diizinkan.",
    unresolvable: "Hostname router tidak dapat diselesaikan (DNS).",
  };
  return new AppError("HOST_NOT_ALLOWED", messages[reason] ?? "Target tidak diizinkan.", 400);
}

export function probeError(probe: SshProbeResult): AppError {
  const map: Record<SshProbeResult["kind"], { code: ApiErrorCode; status: number }> = {
    ok: { code: "INTERNAL_ERROR", status: 500 },
    "auth-failed": { code: "SSH_AUTH_FAILED", status: 400 },
    unreachable: { code: "SSH_UNREACHABLE", status: 502 },
    timeout: { code: "SSH_TIMEOUT", status: 504 },
    refused: { code: "SSH_UNREACHABLE", status: 502 },
    "hostkey-changed": { code: "HOST_KEY_CHANGED", status: 400 },
    unknown: { code: "INTERNAL_ERROR", status: 500 },
  };
  const mapped = map[probe.kind];
  return new AppError(mapped.code, probe.message, mapped.status);
}
