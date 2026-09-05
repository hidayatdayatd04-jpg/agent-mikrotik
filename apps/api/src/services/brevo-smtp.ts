import nodemailer from "nodemailer";
import type { EmailSender } from "./auth";
import type { Logger } from "../lib/logger";

/**
 * Brevo SMTP sender — verified working (2026-09-05): AUTH LOGIN over TLS 1.3
 * on smtp-relay.brevo.com:587 with the SMTP key. The Brevo REST API rejects
 * this host's IP (not in the authorised-IPs list), so SMTP is the working path.
 */
export class BrevoSmtpSender implements EmailSender {
  private transporter: nodemailer.Transporter;
  private senderName: string;
  private senderEmail: string;

  constructor(
    opts: { host: string; port: number; login: string; smtpKey: string; senderName: string; senderEmail: string },
    private log: Logger,
  ) {
    this.senderName = opts.senderName;
    this.senderEmail = opts.senderEmail;
    this.transporter = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: false, // 587 → STARTTLS
      auth: { user: opts.login, pass: opts.smtpKey },
      tls: { rejectUnauthorized: true },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }

  async sendOtp(to: string, code: string, ttlSeconds: number): Promise<void> {
    const minutes = Math.max(1, Math.round(ttlSeconds / 60));
    const maskedTo = to.replace(/(.{2}).+(@.+)/, "$1***$2");
    try {
      await this.transporter.sendMail({
        from: `"${this.senderName}" <${this.senderEmail}>`,
        to,
        subject: `Kode OTP MikroTik AI Agent (${minutes} menit)`,
        text: `Kode OTP Anda: ${code}\n\nBerlaku ${minutes} menit. Jangan bagikan kode ini kepada siapa pun.`,
        html: `<p>Kode OTP Anda: <strong style="font-size:18px;letter-spacing:2px">${code}</strong></p><p>Berlaku ${minutes} menit. Jangan bagikan kode ini kepada siapa pun.</p>`,
      });
      this.log.info("otp email terkirim via Brevo SMTP", { to: maskedTo });
    } catch (err) {
      this.log.error("otp email gagal via Brevo SMTP", { to: maskedTo, message: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }
}
