import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";

export function WebSearchSection() {
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<{ configured: boolean; updatedAt: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ configured: boolean; updatedAt: string | null }>("/api/web-search-settings")
      .then(setStatus)
      .catch(() => setStatus({ configured: false, updatedAt: null }));
  }, []);

  async function save() {
    if (apiKey.trim().length < 8) {
      toast.error("API key terlalu pendek.");
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ configured: boolean; updatedAt: string }>("/api/web-search-settings", {
        method: "POST",
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      setStatus(res);
      setApiKey("");
      toast.success("API key Tavily tersimpan.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan API key.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await apiFetch("/api/web-search-settings", { method: "DELETE" });
      setStatus({ configured: false, updatedAt: null });
      toast.success("API key Tavily dihapus.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus API key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-6">
      <div>
        <h2 className="text-base font-semibold">Deep Research</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Riset internet real-time (Tavily) untuk AI. Setelah API key tersimpan, AI otomatis melakukan riset mendalam — beberapa pencarian bertahap
          dari sudut pandang berbeda — kapan pun membutuhkan informasi terkini atau pengetahuan di luar router. Hasilnya tampil sebagai kartu sumber
          (judul + tautan) di chat. Tidak ada tombol aktif/nonaktif terpisah; hapus API key di bawah bila ingin menonaktifkan.
        </p>
      </div>
      <p className="text-sm">
        Status:{" "}
        {status?.configured ? (
          <span className="font-medium text-emerald-600">Aktif (key tersimpan)</span>
        ) : (
          <span className="text-muted-foreground">Belum dikonfigurasi</span>
        )}
      </p>
      <div className="space-y-2">
        <label htmlFor="tavily-key" className="text-xs font-medium">
          API key Tavily
        </label>
        <Input id="tavily-key" type="password" placeholder="tvly-..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void save()} disabled={busy || apiKey.trim().length < 8}>
          {busy ? "Menyimpan…" : "Simpan"}
        </Button>
        {status?.configured && (
          <Button size="sm" variant="outline" onClick={() => void remove()} disabled={busy}>
            Hapus
          </Button>
        )}
      </div>
    </div>
  );
}
