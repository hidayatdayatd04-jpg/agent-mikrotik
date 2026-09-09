export type WriteBlockCertainty = "certain" | "likely" | "unknown";

export interface WriteBlockEvidence {
  mode: "read-only" | "write";
  connected: boolean;
  hasIdentity: boolean;
  /**
   * Stored connector secret known-empty (direct check), false when a secret
   * is stored, null when the check itself failed. Never the secret itself.
   */
  emptyCredential: boolean | null;
  /** Raw begin() failure text, null when no begin was attempted. */
  beginError: string | null;
}

export interface WriteBlockDiagnosis {
  certainty: WriteBlockCertainty;
  /** Short machine label for logs. */
  cause:
    | "read-only-mode"
    | "router-disconnected"
    | "empty-credential"
    | "password-change-hold"
    | "prompt-unreachable"
    | "transaction-busy"
    | "transaction-unknown"
    | "unclassified";
  /** System-prompt text (Bahasa Indonesia). Empty when nothing must be added. */
  note: string;
}
