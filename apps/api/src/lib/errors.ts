import type { ApiErrorCode } from "@shared/index";
import type { Context } from "hono";

export class AppError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const StatusCodeByCode = {
  UNAUTHORIZED: 401,
  RATE_LIMITED: 429,
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  SSH_AUTH_FAILED: 400,
  SSH_TIMEOUT: 504,
  SSH_UNREACHABLE: 502,
  HOST_KEY_CHANGED: 400,
  HOST_NOT_ALLOWED: 400,
  WRITE_DISABLED: 403,
  POLICY_CHANGED: 409,
  SAFE_MODE_UNAVAILABLE: 409,
  TOOL_UNSUPPORTED: 400,
  TRANSACTION_UNKNOWN: 409,
  RUN_ALREADY_ACTIVE: 409,
  PROVIDER_NOT_CONFIGURED: 400,
  UPSTREAM_AUTH_FAILED: 400,
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_ERROR: 502,
  FILE_TOO_LARGE: 413,
  STORAGE_UNAVAILABLE: 502,
  CONFLICT: 409,
  UPLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INTERNAL_ERROR: 500,
} as const satisfies Record<ApiErrorCode, number>;

export type ErrorCodeWithStatus = keyof typeof StatusCodeByCode;

export function statusForCode(code: ApiErrorCode): number {
  return (StatusCodeByCode as Record<ApiErrorCode, number | undefined>)[code] ?? 500;
}

export function errorBody(c: Context, err: unknown) {
  const requestId = c.get("requestId") ?? "unknown";
  if (err instanceof AppError) {
    return {
      error: {
        code: err.code,
        message: err.message,
        requestId,
        ...(err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}),
      },
    };
  }
  return {
    error: {
      code: "INTERNAL_ERROR" as const,
      message: "Terjadi kesalahan internal. Silakan coba lagi.",
      requestId,
    },
  };
}

