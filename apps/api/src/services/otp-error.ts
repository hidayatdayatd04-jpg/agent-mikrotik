export class OtpError extends Error {
  constructor(
    public readonly code: "OTP_INVALID" | "OTP_EXPIRED" | "OTP_CONSUMED",
    message: string,
  ) {
    super(message);
    this.name = "OtpError";
  }
}
