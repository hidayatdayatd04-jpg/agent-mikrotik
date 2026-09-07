export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    fieldErrors?: Record<string, string>;
  };
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiErrorTitle(error: unknown): string {
  const detail = error instanceof ApiError
    ? (error.status > 0 ? `Status ${error.status} / ${error.code}` : error.code)
    : null;
  return `Gagal Mengirim Pesan${detail ? ` (${detail})` : ""}`;
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    let code = "INTERNAL_ERROR";
    let message: string | undefined;
    let fieldErrors: Record<string, string> | undefined;

    if (body && typeof body === "object") {
      const b = body as Record<string, unknown>;
      const errObj = (b.error ?? b) as Record<string, unknown>;
      if (typeof errObj === "object" && errObj !== null) {
        if (typeof errObj.code === "string") code = errObj.code;
        if (typeof errObj.message === "string") message = errObj.message;
        if (errObj.fieldErrors && typeof errObj.fieldErrors === "object") {
          fieldErrors = errObj.fieldErrors as Record<string, string>;
        }

        // Handle Zod issues array:
        const issues = Array.isArray(errObj.issues)
          ? errObj.issues
          : Array.isArray(b.issues)
            ? b.issues
            : null;
        if (issues && issues.length > 0) {
          code = code === "INTERNAL_ERROR" ? "VALIDATION_FAILED" : code;
          fieldErrors = fieldErrors || {};
          for (const item of issues as { path?: (string | number)[]; message?: string }[]) {
            const field = item.path?.[0] !== undefined ? String(item.path[0]) : "general";
            if (item.message && !fieldErrors[field]) {
              fieldErrors[field] = item.message;
            }
          }
          if (!message || message.startsWith("[\n") || message === "ZodError") {
            const firstIssue = (issues[0] as { message?: string })?.message;
            message = firstIssue ?? "Validasi input tidak sesuai.";
          }
        }
      }
    }

    if (code === "BACKEND_UNAVAILABLE" || (res.status >= 500 && body === null)) {
      code = "BACKEND_UNAVAILABLE";
      message = "Backend API (port 3001) tidak aktif atau baru restart. Tunggu sebentar lalu coba lagi.";
    } else if (res.status === 400 && !message) {
      message = "Permintaan tidak valid atau ditolak oleh server (Status 400).";
    } else if (!message) {
      message = `Request gagal dengan status ${res.status}.`;
    }

    throw new ApiError(code, message, res.status, fieldErrors);
  }

  return body as T;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (netErr) {
    throw new ApiError(
      "NETWORK_ERROR",
      `Gagal menghubungi server backend: ${netErr instanceof Error ? netErr.message : "Network error"}. Pastikan backend di port 3001 berjalan.`,
      0,
    );
  }
  try {
    return await parseResponse<T>(res);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.code === "UNAUTHORIZED")) {
      if (!path.startsWith("/api/auth/") && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("auth:unauthorized"));
      }
    }
    throw err;
  }
}

export async function apiForm<T>(path: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", body: form, credentials: "same-origin" });
  } catch (netErr) {
    throw new ApiError(
      "NETWORK_ERROR",
      `Gagal mengunggah file: ${netErr instanceof Error ? netErr.message : "Network error"}.`,
      0,
    );
  }
  try {
    return await parseResponse<T>(res);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.code === "UNAUTHORIZED")) {
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("auth:unauthorized"));
    }
    throw err;
  }
}
