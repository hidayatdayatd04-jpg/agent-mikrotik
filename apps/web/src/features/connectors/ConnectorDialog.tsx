import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateConnector } from "./connector-hooks";
import { ApiError } from "@/lib/api";
import { Server, Eye, EyeOff, Loader2, AlertCircle, Lock } from "@/components/icons";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues?: {
    label?: string;
    host?: string;
    port?: number;
    username?: string;
  } | null;
}

function classifyHint(code: string, message?: string): string {
  switch (code) {
    case "SSH_AUTH_FAILED":
      return "Username atau password SSH salah. Jika router baru / default MikroTik CHR, password bawaan biasanya kosong (coba kosongkan field password).";
    case "SSH_UNREACHABLE":
      return "Host tidak terjangkau atau port SSH ditolak. Pastikan service SSH aktif di menu 'IP > Services' pada WinBox.";
    case "SSH_TIMEOUT":
      return "Koneksi SSH kehabisan waktu (timeout). Periksa firewall atau konektivitas jaringan host ke router.";
    case "HOST_KEY_CHANGED":
      return "Fingerprint host key router berubah. Periksa apakah router baru diganti atau di-reset.";
    case "HOST_NOT_ALLOWED":
      return "Alamat router ditolak oleh kebijakan keamanan target lokal.";
    case "VALIDATION_FAILED":
      return "Periksa kembali data pada form di atas yang ditandai merah.";
    default:
      if (message && message.includes("400")) {
        return "Periksa kembali username, password, atau konfigurasi SSH router Anda di WinBox.";
      }
      return "";
  }
}

export function ConnectorDialog({ open, onOpenChange, initialValues }: Props) {
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<{ code: string; message: string } | null>(null);

  const create = useCreateConnector();

  useEffect(() => {
    if (open) {
      if (initialValues) {
        if (initialValues.label) setLabel(initialValues.label);
        if (initialValues.host) setHost(initialValues.host);
        if (initialValues.port) setPort(String(initialValues.port));
        if (initialValues.username) setUsername(initialValues.username);
      }
    } else {
      reset();
    }
  }, [open, initialValues]);

  const canSubmit =
    label.trim() !== "" &&
    host.trim() !== "" &&
    username.trim() !== "" &&
    !create.isPending;

  function reset() {
    setLabel("");
    setHost("");
    setPort("22");
    setUsername("");
    setPassword("");
    setShowPassword(false);
    setFieldErrors({});
    setApiError(null);
    create.reset();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError(null);
    setFieldErrors({});
    const cleanPort = port.trim();
    const portNum = cleanPort === "" ? 22 : Number(cleanPort);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setFieldErrors({ port: "Port harus berupa angka antara 1–65535." });
      return;
    }
    try {
      await create.mutateAsync({
        label: label.trim(),
        host: host.trim(),
        port: portNum,
        username: username.trim(),
        password,
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError) {
        setApiError({ code: err.code, message: err.message });
        if (err.fieldErrors) setFieldErrors(err.fieldErrors);
      } else {
        setApiError({ code: "INTERNAL_ERROR", message: "Terjadi kesalahan tak terduga saat menghubungi router." });
      }
    }
  }

  const hint = apiError ? classifyHint(apiError.code, apiError.message) : "";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!create.isPending) {
          onOpenChange(o);
          if (o) reset();
        }
      }}
    >
      <DialogContent className="sm:max-w-md border-border/80 bg-card/95 backdrop-blur-md">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <Server className="size-4" />
            </div>
            <DialogTitle className="text-base font-semibold">Tambah Connector Router</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Kredensial SSH akan diverifikasi secara langsung sebelum disimpan ke database lokal.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4 pt-1">
          {/* Label */}
          <div className="space-y-1.5">
            <Label htmlFor="conn-label" className="text-xs font-medium">
              Nama / Label Router
            </Label>
            <Input
              id="conn-label"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                if (fieldErrors.label) {
                  setFieldErrors((prev) => {
                    const { label: _, ...rest } = prev;
                    return rest;
                  });
                }
              }}
              maxLength={200}
              placeholder="Contoh: Router Kantor Utama / RB4011"
              className="text-xs"
              autoFocus
            />
            {fieldErrors.label && (
              <p className="text-[11px] text-destructive">{fieldErrors.label}</p>
            )}
          </div>

          {/* Host and Port */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="conn-host" className="text-xs font-medium">
                Host / IP Address
              </Label>
              <Input
                id="conn-host"
                value={host}
                onChange={(e) => {
                  setHost(e.target.value);
                  if (fieldErrors.host) {
                    setFieldErrors((prev) => {
                      const { host: _, ...rest } = prev;
                      return rest;
                    });
                  }
                }}
                placeholder="192.168.88.1"
                autoComplete="off"
                className="font-mono text-xs"
              />
              {fieldErrors.host && (
                <p className="text-[11px] text-destructive">{fieldErrors.host}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="conn-port" className="text-xs font-medium">
                Port SSH
              </Label>
              <Input
                id="conn-port"
                value={port}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  setPort(val);
                  if (fieldErrors.port) {
                    setFieldErrors((prev) => {
                      const { port: _, ...rest } = prev;
                      return rest;
                    });
                  }
                }}
                inputMode="numeric"
                placeholder="22"
                className="font-mono text-xs"
              />
              {fieldErrors.port && (
                <p className="text-[11px] text-destructive">{fieldErrors.port}</p>
              )}
            </div>
          </div>

          {/* Username */}
          <div className="space-y-1.5">
            <Label htmlFor="conn-username" className="text-xs font-medium">
              Username SSH
            </Label>
            <Input
              id="conn-username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (fieldErrors.username) {
                  setFieldErrors((prev) => {
                    const { username: _, ...rest } = prev;
                    return rest;
                  });
                }
              }}
              placeholder="admin"
              autoComplete="off"
              className="font-mono text-xs"
            />
            {fieldErrors.username && (
              <p className="text-[11px] text-destructive">{fieldErrors.username}</p>
            )}
          </div>

          {/* Password with Eye toggle */}
          <div className="space-y-1.5">
            <Label htmlFor="conn-password" className="text-xs font-medium">
              Password SSH
            </Label>
            <div className="relative">
              <Input
                id="conn-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password) {
                    setFieldErrors((prev) => {
                      const { password: _, ...rest } = prev;
                      return rest;
                    });
                  }
                }}
                autoComplete="new-password"
                placeholder="Kosongkan jika default tanpa password"
                className="pr-9 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                aria-label={showPassword ? "Sembunyikan password" : "Lihat password"}
              >
                {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
            {fieldErrors.password && (
              <p className="text-[11px] text-destructive">{fieldErrors.password}</p>
            )}
            <div className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground pt-0.5">
              <div className="flex items-center gap-1">
                <Lock className="size-3 text-emerald-500 shrink-0" />
                <span>Disimpan terenkripsi AES-256-GCM.</span>
              </div>
              <span className="text-[10px] text-indigo-500/80">Default WinBox: tanpa password</span>
            </div>
          </div>

          {/* API Error Callout */}
          {apiError && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive space-y-1 animate-in fade-in duration-150">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertCircle className="size-4 shrink-0" />
                <span>{apiError.message}</span>
              </div>
              {hint && <p className="pl-5 text-muted-foreground leading-relaxed">{hint}</p>}
            </div>
          )}

          <DialogFooter className="pt-2 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
              disabled={create.isPending}
              className="h-9 text-xs"
            >
              Batal
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="h-9 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-sm"
            >
              {create.isPending && <Loader2 className="size-3.5 animate-spin" />}
              {create.isPending ? "Menguji Koneksi SSH…" : "Uji & Simpan Router"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
