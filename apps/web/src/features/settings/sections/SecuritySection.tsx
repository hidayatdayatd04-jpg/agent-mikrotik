import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsPage } from "@/features/chat/SettingsPage";
import { apiFetch } from "@/lib/api";

export function SecuritySection() {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [busy, setBusy] = useState(false);
  async function change() {
    setBusy(true);
    try {
      await apiFetch("/api/auth/password", { method: "POST", body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw }) });
      toast.success("Password diubah; sesi lain direvokasi.");
      setOldPw("");
      setNewPw("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengubah password.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/70 bg-card/60 p-6">
        <h2 className="text-base font-semibold">Keamanan & Safe Mode</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Kredensial SSH tersimpan terenkripsi AES-256-GCM. Write hanya dalam transaksi Safe Mode backend; lifecycle tidak tersedia untuk model.
          Recovery restart memutus connector dan mereset Write.
        </p>
      </div>
      <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-6">
        <h3 className="text-sm font-semibold">Ubah password</h3>
        <Input type="password" placeholder="Password lama" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" />
        <Input type="password" placeholder="Password baru (min 8)" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
        <Button size="sm" disabled={busy || !oldPw || newPw.length < 8} onClick={() => void change()}>
          {busy ? "Menyimpan…" : "Ubah password"}
        </Button>
      </div>
      <SettingsPage initialTab="safemode" hideHeader />
    </div>
  );
}
