import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { usePreferences, useSavePreferences } from "@/features/chat/chat-hooks";

export function AppearanceSection() {
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
