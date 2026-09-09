import { Button } from "@/components/ui/button";
import { Server, Plus, ShieldCheck } from "@/components/icons";

export function ConnectorsHeader(props: { totalCount: number; connectedCount: number; onAdd: () => void }) {
  return (
    <>
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-500">
            <Server className="size-3.5" />
            Device Management
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Connector Router</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Kelola router MikroTik target. Kredensial SSH disimpan dengan enkripsi AES-256-GCM.
          </p>
        </div>

        <Button
          onClick={props.onAdd}
          className="gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium self-start sm:self-auto shadow-sm"
        >
          <Plus className="size-4" />
          Tambah Router Manual
        </Button>
      </div>

      {/* Metrics Cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border/70 bg-card/60 p-4">
          <span className="text-xs text-muted-foreground">Total Router Terdaftar</span>
          <p className="mt-1 text-2xl font-bold font-mono">{props.totalCount}</p>
        </div>
        <div className="rounded-xl border border-border/70 bg-card/60 p-4">
          <span className="text-xs text-muted-foreground">Router Terhubung</span>
          <p className="mt-1 text-2xl font-bold font-mono text-emerald-500">{props.connectedCount}</p>
        </div>
        <div className="rounded-xl border border-border/70 bg-card/60 p-4">
          <span className="text-xs text-muted-foreground">Proteksi Transaksi</span>
          <p className="mt-1 text-sm font-semibold flex items-center gap-1.5 text-foreground">
            <ShieldCheck className="size-4 text-emerald-500" />
            Safe Mode Aktif
          </p>
        </div>
      </div>
    </>
  );
}
