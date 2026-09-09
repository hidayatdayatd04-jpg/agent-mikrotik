import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/auth";
import { apiFetch } from "@/lib/api";

export function ProfileSection() {
  const { profile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [busy, setBusy] = useState(false);
  async function save() {
    const name = displayName.trim();
    if (!name) {
      toast.error("Display name tidak boleh kosong.");
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/api/auth/profile", { method: "PATCH", body: JSON.stringify({ displayName: name }) });
      toast.success("Profil diperbarui.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan profil.");
    } finally {
      setBusy(false);
    }
  }
  const initials = (profile?.displayName ?? profile?.username ?? "MA").slice(0, 2).toUpperCase();
  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-6">
      <div className="flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-full bg-indigo-600 font-bold text-white">{initials}</div>
        <div>
          <h2 className="text-base font-semibold">Profil</h2>
          <p className="text-xs text-muted-foreground">
            @{profile?.username} · alias {profile?.loginAlias ?? "-"}
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <label htmlFor="display-name" className="text-xs font-medium">
          Display name
        </label>
        <Input id="display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={100} />
      </div>
      <Button size="sm" onClick={() => void save()} disabled={busy}>
        {busy ? "Menyimpan…" : "Simpan"}
      </Button>
    </div>
  );
}
