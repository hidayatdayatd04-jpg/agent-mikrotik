import { ArrowLeft, Plug, Key, User, Palette, Database, ShieldCheck, Archive, Info, HelpCircle } from "lucide-react";
import { ConnectorsPanel } from "@/features/connectors/ConnectorsPanel";
import { SettingsPage } from "@/features/chat/SettingsPage";
import { useArchivedConversations, useConversationActions, usePreferences, useSavePreferences, useCompactionStatus } from "@/features/chat/chat-hooks";
import { useAuth } from "@/features/auth/auth";
import { apiFetch } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useState } from "react";
import { toast } from "sonner";
import { navigate } from "@/lib/router";

const NAV = [
  { id: "connectors", label: "Connector Router", icon: Plug },
  { id: "providers", label: "Provider AI", icon: Key },
  { id: "profile", label: "Profil", icon: User },
  { id: "appearance", label: "Tampilan", icon: Palette },
  { id: "context", label: "Konteks", icon: Database },
  { id: "security", label: "Keamanan & Safe Mode", icon: ShieldCheck },
  { id: "archive", label: "Arsip", icon: Archive },
  { id: "about", label: "Tentang", icon: Info },
  { id: "help", label: "Bantuan", icon: HelpCircle },
];

export function SettingsShell(props: { section: string; returnTo?: string | null; autoAdd?: boolean; onUseInChat?: (id: string) => void; onBack: () => void }) {
  const section = NAV.some((n) => n.id === props.section) ? props.section : "connectors";
  return (
    <div className="flex h-full overflow-hidden">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border/60 bg-sidebar/95 md:flex">
        <div className="p-3">
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-xs" onClick={props.onBack}>
            <ArrowLeft className="size-3.5" /> Kembali ke chat
          </Button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4" aria-label="Pengaturan">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = n.id === section;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => navigate({ name: "settings", section: n.id })}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium transition-colors ${
                  active ? "bg-card text-foreground shadow-xs ring-1 ring-border" : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="size-4 text-indigo-500" />
                {n.label}
              </button>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2 md:hidden">
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={props.onBack}>
            <ArrowLeft className="size-3.5" /> Chat
          </Button>
          <select
            value={section}
            onChange={(e) => navigate({ name: "settings", section: e.target.value })}
            className="h-8 flex-1 rounded-lg border border-border/70 bg-background px-2 text-xs"
            aria-label="Pilih halaman pengaturan"
          >
            {NAV.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto max-w-4xl">
            {section === "connectors" && <ConnectorsPanel autoOpenAdd={props.autoAdd} returnTo={props.returnTo} onUseInChat={props.onUseInChat} />}
            {section === "providers" && <ProvidersSection />}
            {section === "profile" && <ProfileSection />}
            {section === "appearance" && <AppearanceSection />}
            {section === "context" && <ContextSection />}
            {section === "security" && <SecuritySection />}
            {section === "archive" && <ArchiveSection />}
            {section === "about" && <AboutSection />}
            {section === "help" && <HelpSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProvidersSection() {
  // Reuse existing provider settings UI (business component) inside settings shell.
  return <SettingsPage initialTab="provider" />;
}

function ProfileSection() {
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
          <p className="text-xs text-muted-foreground">@{profile?.username} · alias {profile?.loginAlias ?? "-"}</p>
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

function AppearanceSection() {
  const prefs = usePreferences();
  const save = useSavePreferences();
  const theme = prefs.data?.theme ?? "system";
  function setTheme(next: "light" | "dark" | "system") {
    if (next === "dark") {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else if (next === "light") {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    } else {
      localStorage.removeItem("theme");
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.classList.add("dark");
      else document.documentElement.classList.remove("dark");
    }
    save.mutate({ theme: next });
  }
  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-6">
      <h2 className="text-base font-semibold">Tampilan</h2>
      <p className="text-xs text-muted-foreground">Tema persisten; default mengikuti sistem. Diterapkan sebelum render untuk menghindari flash.</p>
      <div className="flex gap-2">
        {(["light", "dark", "system"] as const).map((t) => (
          <Button key={t} size="sm" variant={theme === t ? "default" : "outline"} onClick={() => setTheme(t)}>
            {t === "light" ? "Terang" : t === "dark" ? "Gelap" : "Sistem"}
          </Button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-4">
        <div>
          <p className="text-sm font-medium">Sidebar ringkas default</p>
          <p className="text-xs text-muted-foreground">Mulai dengan icon rail 56–64px.</p>
        </div>
        <Switch
          checked={!!prefs.data?.sidebarCollapsed}
          onCheckedChange={(v) => save.mutate({ sidebarCollapsed: v })}
          aria-label="Sidebar ringkas"
        />
      </div>
    </div>
  );
}

function ContextSection() {
  const prefs = usePreferences();
  const save = useSavePreferences();
  // Show last compaction status for active conversation? Use global explanation + per-chat via header.
  const status = useCompactionStatus(null);
  void status;
  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-6">
      <h2 className="text-base font-semibold">Konteks / compact</h2>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Compact meringkas history yang dikirim ke model agar percakapan dapat berlanjut. History asli tidak dihapus, transcript visual tidak
        dipotong, dan export tetap lengkap. Ambang awal 80% dari input budget efektif; target setelah compact 50–60%.
      </p>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">Compact otomatis (default ON)</span>
        <Switch checked={prefs.data?.autoCompact ?? true} onCheckedChange={(v) => save.mutate({ autoCompact: v })} aria-label="Compact otomatis" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="compact-threshold" className="text-xs font-medium">
          Ambang pemakaian ({prefs.data?.compactThreshold ?? 80}%)
        </label>
        <Input
          id="compact-threshold"
          type="number"
          min={50}
          max={95}
          value={prefs.data?.compactThreshold ?? 80}
          onChange={(e) => save.mutate({ compactThreshold: Number(e.target.value) || 80 })}
        />
      </div>
    </div>
  );
}

function SecuritySection() {
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

function ArchiveSection() {
  const archived = useArchivedConversations();
  const items = archived.data ?? [];
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">Arsip percakapan</h2>
      {archived.isLoading && <p className="text-xs text-muted-foreground">Memuat arsip…</p>}
      {archived.isError && <p className="text-xs text-destructive">Gagal memuat arsip.</p>}
      {!archived.isLoading && items.length === 0 && <p className="text-xs text-muted-foreground">Arsip kosong.</p>}
      <ul className="space-y-2">
        {items.map((c) => (
          <ArchiveRow key={c.id} id={c.id} title={c.title} />
        ))}
      </ul>
    </div>
  );
}

function ArchiveRow({ id, title }: { id: string; title: string }) {
  const actions = useConversationActions(id);
  return (
    <li className="flex items-center justify-between gap-2 rounded-xl border border-border/70 bg-card/60 px-3 py-2 text-xs">
      <span className="truncate">{title}</span>
      <span className="flex shrink-0 gap-1">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => actions.setArchived(false).then(() => toast.success("Dipulihkan."))}>
          Pulihkan
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => navigate({ name: "chat", id })}>
          Buka
        </Button>
      </span>
    </li>
  );
}

function AboutSection() {
  const diag = useQuery({
    queryKey: ["health"],
    queryFn: () => apiFetch<{ status: string; checks: { database: string } }>("/health/ready"),
    retry: 1,
  });
  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-6">
      <h2 className="text-base font-semibold">Tentang dan diagnostik</h2>
      <p className="text-xs text-muted-foreground">MikroTik AI Agent v0.1.0 — Bun + Hono + SQLite/Drizzle, child MCP MikroTik, transaksi RouterOS Safe Mode.</p>
      <p className="font-mono text-xs">DB: {diag.data?.checks.database ?? "…"} · status {diag.data?.status ?? "…"}</p>
      <SettingsPage initialTab="about" hideHeader />
    </div>
  );
}

function HelpSection() {
  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-6 text-sm leading-relaxed">
      <h2 className="text-base font-semibold">Bantuan</h2>
      <h3 className="font-semibold">Connector SSH</h3>
      <p className="text-xs text-muted-foreground">
        Tambahkan router via Pengaturan → Connector Router. SSH probe memverifikasi kredensial dan identity; discovery/Winbox bukan bukti SSH aktif.
        Jangan gunakan port 8291 untuk SSH (port SSH default 22).
      </p>
      <h3 className="font-semibold">Penggunaan Write</h3>
      <p className="text-xs text-muted-foreground">
        Aktifkan Izinkan perubahan di menu (+) composer hanya saat connected dan identity terverifikasi. Mutasi berjalan dalam transaksi Safe Mode;
        gagal/cancel → rollback, kosong → rollback empty.
      </p>
      <h3 className="font-semibold">Pemulihan koneksi</h3>
      <p className="text-xs text-muted-foreground">
        Disconnect, Write OFF, logout, dan restart mengikuti cleanup backend. Tutup panel bukan bukti command berhenti — periksa status final yang jujur.
      </p>
    </div>
  );
}
