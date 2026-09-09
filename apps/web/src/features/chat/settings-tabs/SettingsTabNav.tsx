import { Key, ShieldCheck, Info } from "@/components/icons";
import type { SettingsTab } from "./provider-templates";

export function SettingsTabNav(props: { activeTab: SettingsTab; onTab: (t: SettingsTab) => void; anyHasKey: boolean }) {
  const { activeTab, onTab, anyHasKey } = props;
  return (
    <div className="mt-6 flex gap-2 border-b border-border/60">
      <button
        type="button"
        onClick={() => onTab("provider")}
        className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-all ${
          activeTab === "provider" ? "border-indigo-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
        }`}
      >
        <Key className="size-4" />
        Provider AI
        {anyHasKey && <span className="size-2 rounded-full bg-emerald-500 ring-2 ring-background" />}
      </button>
      <button
        type="button"
        onClick={() => onTab("safemode")}
        className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-all ${
          activeTab === "safemode" ? "border-indigo-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
        }`}
      >
        <ShieldCheck className="size-4" />
        Keamanan & Safe Mode
      </button>
      <button
        type="button"
        onClick={() => onTab("about")}
        className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-all ${
          activeTab === "about" ? "border-indigo-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
        }`}
      >
        <Info className="size-4" />
        Tentang Sistem
      </button>
    </div>
  );
}
