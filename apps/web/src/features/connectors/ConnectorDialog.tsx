import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useConnectorForm, type ConnectorInitialValues } from "./use-connector-form";
import { ConnectorIdentityFields } from "./ConnectorIdentityFields";
import { ConnectorAuthFields } from "./ConnectorAuthFields";
import { Server, Loader2, AlertCircle } from "@/components/icons";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues?: ConnectorInitialValues | null;
}

export function ConnectorDialog({ open, onOpenChange, initialValues }: Props) {
  const form = useConnectorForm(open, initialValues, onOpenChange);
  const { apiError, hint, canSubmit, isPending } = form;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!isPending) {
          onOpenChange(o);
          if (o) form.reset();
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

        <form onSubmit={(e) => void form.onSubmit(e)} className="space-y-4 pt-1">
          <ConnectorIdentityFields
            label={form.label}
            setLabel={form.setLabel}
            host={form.host}
            setHost={form.setHost}
            port={form.port}
            setPort={form.setPort}
            fieldErrors={form.fieldErrors}
            setFieldErrors={form.setFieldErrors}
          />
          <ConnectorAuthFields
            username={form.username}
            setUsername={form.setUsername}
            password={form.password}
            setPassword={form.setPassword}
            showPassword={form.showPassword}
            setShowPassword={form.setShowPassword}
            fieldErrors={form.fieldErrors}
            setFieldErrors={form.setFieldErrors}
          />

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
                form.reset();
                onOpenChange(false);
              }}
              disabled={isPending}
              className="h-9 text-xs"
            >
              Batal
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="h-9 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-sm"
            >
              {isPending && <Loader2 className="size-3.5 animate-spin" />}
              {isPending ? "Menguji Koneksi SSH…" : "Uji & Simpan Router"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
