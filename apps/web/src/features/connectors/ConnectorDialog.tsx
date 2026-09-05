import { useState } from "react";
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
import { Field, FieldGroup, FieldLabel, FieldDescription, FieldError } from "@/components/ui/field";
import { useCreateConnector } from "./connector-hooks";
import { ApiError } from "@/lib/api";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function classifyHint(code: string): string {
  switch (code) {
    case "SSH_AUTH_FAILED":
      return "Username/password salah. Periksa kredensial router Anda.";
    case "SSH_UNREACHABLE":
      return "Host tidak terjangkau atau port SSH ditolak. Periksa IP/port dan service SSH.";
    case "SSH_TIMEOUT":
      return "Koneksi SSH kehabisan waktu. Periksa jaringan/firewall.";
    case "HOST_KEY_CHANGED":
      return "Fingerprint host key router berubah. Periksa apakah router diganti/di-reset.";
    case "HOST_NOT_ALLOWED":
      return "Alamat router ditolak kebijakan target. Hubungi admin atau gunakan alamat lain.";
    default:
      return "";
  }
}

export function ConnectorDialog({ open, onOpenChange }: Props) {
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<{ code: string; message: string } | null>(null);

  const create = useCreateConnector();

  const canSubmit = label.trim() !== "" && host.trim() !== "" && username.trim() !== "" && password !== "" && !create.isPending;

  function reset() {
    setLabel("");
    setHost("");
    setPort("22");
    setUsername("");
    setPassword("");
    setFieldErrors({});
    setApiError(null);
    create.reset();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError(null);
    setFieldErrors({});
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setFieldErrors({ port: "Port harus angka 1–65535." });
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
      // form stays open with data intact — classified error shown
      if (err instanceof ApiError) {
        setApiError({ code: err.code, message: err.message });
        if (err.fieldErrors) setFieldErrors(err.fieldErrors);
      } else {
        setApiError({ code: "INTERNAL_ERROR", message: "Terjadi kesalahan tak terduga." });
      }
    }
  }

  const hint = apiError ? classifyHint(apiError.code) : "";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!create.isPending) { onOpenChange(o); if (o) reset(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah Connector Router</DialogTitle>
          <DialogDescription>
            Kredensial diuji lewat SSH sebelum disimpan. Jika gagal, form tetap terbuka.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field data-invalid={fieldErrors.label ? "true" : undefined}>
              <FieldLabel htmlFor="conn-label">Label</FieldLabel>
              <Input id="conn-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} placeholder="Router Kantor" />
              <FieldError errors={fieldErrors.label ? [{ message: fieldErrors.label }] : undefined} />
            </Field>
            <Field data-invalid={fieldErrors.host ? "true" : undefined}>
              <FieldLabel htmlFor="conn-host">Host / IP</FieldLabel>
              <Input id="conn-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.88.1" autoComplete="off" />
              <FieldDescription>Alamat IP atau hostname router.</FieldDescription>
              <FieldError errors={fieldErrors.host ? [{ message: fieldErrors.host }] : undefined} />
            </Field>
            <Field data-invalid={fieldErrors.port ? "true" : undefined}>
              <FieldLabel htmlFor="conn-port">Port SSH</FieldLabel>
              <Input id="conn-port" value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" placeholder="22" />
              <FieldError errors={fieldErrors.port ? [{ message: fieldErrors.port }] : undefined} />
            </Field>
            <Field data-invalid={fieldErrors.username ? "true" : undefined}>
              <FieldLabel htmlFor="conn-username">Username</FieldLabel>
              <Input id="conn-username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
              <FieldError errors={fieldErrors.username ? [{ message: fieldErrors.username }] : undefined} />
            </Field>
            <Field data-invalid={fieldErrors.password ? "true" : undefined}>
              <FieldLabel htmlFor="conn-password">Password</FieldLabel>
              <Input id="conn-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              <FieldDescription>Disimpan terenkripsi (AES-256-GCM), tidak pernah dikirim ke model.</FieldDescription>
              <FieldError errors={fieldErrors.password ? [{ message: fieldErrors.password }] : undefined} />
            </Field>
          </FieldGroup>

          {apiError && (
            <div className="border-destructive/50 bg-destructive/10 text-destructive mt-4 flex flex-col gap-1 rounded-md border p-3 text-sm">
              <span className="font-medium">{apiError.message}</span>
              {hint && <span className="text-muted-foreground">{hint}</span>}
            </div>
          )}

          <DialogFooter className="mt-4 gap-2">
            <Button type="button" variant="outline" onClick={() => { reset(); onOpenChange(false); }} disabled={create.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {create.isPending ? "Menguji koneksi…" : "Uji & Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
