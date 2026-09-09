import { z } from "zod";

export const API_ERROR_CODES = [
  "UNAUTHORIZED",
  "RATE_LIMITED",
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "FORBIDDEN",
  "SSH_AUTH_FAILED",
  "SSH_TIMEOUT",
  "SSH_UNREACHABLE",
  "HOST_KEY_CHANGED",
  "HOST_NOT_ALLOWED",
  "WRITE_DISABLED",
  "POLICY_CHANGED",
  "SAFE_MODE_UNAVAILABLE",
  "TOOL_UNSUPPORTED",
  "TRANSACTION_UNKNOWN",
  "RUN_ALREADY_ACTIVE",
  "PROVIDER_NOT_CONFIGURED",
  "UPSTREAM_AUTH_FAILED",
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_ERROR",
  "UPSTREAM_INVALID_REQUEST",
  "UPSTREAM_RATE_LIMITED",
  "UPSTREAM_QUOTA_EXHAUSTED",
  "FILE_TOO_LARGE",
  "STORAGE_UNAVAILABLE",
  "CONFLICT",
  "UPLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "INTERNAL_ERROR",
] as const;

export const ApiErrorCodes = API_ERROR_CODES;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const ApiErrorSchema = z.object({
  code: z.enum(API_ERROR_CODES),
  message: z.string(),
  requestId: z.string(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
