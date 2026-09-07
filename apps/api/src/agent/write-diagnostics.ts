/**
 * Structured write-block diagnosis for the agent's system prompt.
 *
 * Certainty discipline (the model must relay this honestly):
 * - "certain": verified by a direct check (stored secret, connection state,
 *   explicit router output). May be stated as fact with exact fix steps.
 * - "likely": best-ranked hypotheses with a way to verify each. The model
 *   must present them as possibilities, never as fact.
 * - "unknown": only the raw error may be quoted, plus generic recovery.
 *
 * Hard rule baked into every note: the model cannot observe the UI toggle.
 * The MODE OPERASI line of the system instruction is its only source of
 * truth about the mode — speculating about "(tidak) tersinkron" is forbidden.
 */

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

const PW_MARKERS = /change your password|new password\s*>|penggantian password/i;
const PROMPT_TIMEOUT_MARKERS = /timed out waiting for .*shell prompt|safe mode did not activate|shell prompt/i;
const BUSY_MARKERS = /sedang dipakai transaksi lain/i;
const UNKNOWN_TX_MARKERS = /status tidak diketahui/i;

const HONESTY_FOOTER =
  "Tool pembacaan tetap tersedia, tetapi mutasi akan ditolak. " +
  "Jelaskan keadaan ini dengan jujur dan jangan mengarang hasil perubahan. " +
  "Status toggle di layar tidak dapat kamu lihat — baris MODE OPERASI pada instruksi ini adalah satu-satunya sumber kebenaran tentang modemu; " +
  "jangan pernah berspekulasi bahwa toggle (tidak) tersinkron.";

const CERTAIN_PASSWORD_NOTE =
  "Transaksi Safe Mode tidak dibuka karena RouterOS menahan shell interaktif pada perintah ganti password " +
  "(kredensial connector yang tersimpan kosong — terverifikasi langsung). " +
  "Minta pengguna: (1) mengatur password admin di router, (2) memperbarui kredensial connector di panel Connector, " +
  "(3) menyambungkan ulang, (4) mengaktifkan mode Write, (5) mencoba lagi. " +
  "Menyalakan-mematikan toggle saja tidak akan mengubah apa pun selama password belum diisi.";

export function diagnoseWriteBlock(ev: WriteBlockEvidence): WriteBlockDiagnosis {
  const level = (c: WriteBlockCertainty) =>
    `\n\nCATATAN SISTEM (keyakinan: ${c === "certain" ? "pasti" : c === "likely" ? "kemungkinan" : "belum diketahui"}): `;

  if (ev.mode === "read-only") {
    return { certainty: "certain", cause: "read-only-mode", note: "" };
  }

  if (!ev.connected || !ev.hasIdentity) {
    return {
      certainty: "certain",
      cause: "router-disconnected",
      note:
        level("certain") +
        "router belum tersambung atau belum terverifikasi sehingga transaksi Safe Mode tidak dibuka. " +
        "Minta pengguna menyambungkan router di panel Connector, lalu mengaktifkan mode Write dan mencoba lagi. " +
        HONESTY_FOOTER,
    };
  }

  // Direct check beats any error text: an empty stored secret guarantees the
  // interactive shell is held at the password-change prompt.
  if (ev.emptyCredential === true || (ev.beginError && PW_MARKERS.test(ev.beginError))) {
    return {
      certainty: "certain",
      cause: ev.emptyCredential === true ? "empty-credential" : "password-change-hold",
      note: level("certain") + CERTAIN_PASSWORD_NOTE + " " + HONESTY_FOOTER,
    };
  }

  if (ev.beginError && BUSY_MARKERS.test(ev.beginError)) {
    return {
      certainty: "certain",
      cause: "transaction-busy",
      note:
        level("certain") +
        "Safe Mode router sedang dipakai transaksi lain. Minta pengguna menunggu transaksi itu selesai " +
        "(atau memutus router dari panel bila macet), lalu mencoba lagi. " +
        HONESTY_FOOTER,
    };
  }

  if (ev.beginError && UNKNOWN_TX_MARKERS.test(ev.beginError)) {
    return {
      certainty: "certain",
      cause: "transaction-unknown",
      note:
        level("certain") +
        "ada transaksi lama berstatus tidak diketahui di router ini sehingga transaksi baru ditolak pengaman. " +
        "Minta pengguna menyambungkan ulang router (disconnect lalu connect) untuk rekonsiliasi, lalu mencoba lagi. " +
        "Bila masih ditolak, jangan mengarang jalan pintas. " +
        HONESTY_FOOTER,
    };
  }

  if (ev.beginError && PROMPT_TIMEOUT_MARKERS.test(ev.beginError)) {
    return {
      certainty: "likely",
      cause: "prompt-unreachable",
      note:
        level("likely") +
        `sesi Safe Mode gagal dibuka karena prompt shell tidak terbaca (${ev.beginError.slice(0, 160)}). ` +
        "Kemungkinan berurutan, BUKAN kepastian: " +
        "(1) router masih menahan shell pada perintah ganti password — pastikan password admin sudah diisi DAN kredensial connector sudah diperbarui dengan password yang sama; " +
        "(2) sesi backend macet — minta pengguna mematikan lalu menyalakan toggle Write (ini memaksa child backend baru) dan mencoba lagi; " +
        "(3) keanehan terminal pada build RouterOS ini. " +
        "Sampaikan sebagai kemungkinan, kutip error di atas apa adanya, dan tawarkan pemeriksaan baca yang relevan. " +
        HONESTY_FOOTER,
    };
  }

  if (ev.beginError) {
    return {
      certainty: "unknown",
      cause: "unclassified",
      note:
        level("unknown") +
        `transaksi Safe Mode gagal dibuka: ${ev.beginError.slice(0, 200)}. ` +
        "Penyebabnya belum diketahui — jangan menebak satu penyebab. Sampaikan error apa adanya, " +
        "sarankan menyambungkan ulang router dan mencoba lagi, dan tawarkan pemeriksaan baca. " +
        HONESTY_FOOTER,
    };
  }

  return { certainty: "unknown", cause: "unclassified", note: "" };
}
