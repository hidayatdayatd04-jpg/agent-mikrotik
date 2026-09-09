import { useState } from "react";
import { Cpu } from "@/components/icons";
import { useProviderList } from "./settings-tabs/use-provider-list";
import type { SettingsTab } from "./settings-tabs/provider-templates";
import { SettingsTabNav } from "./settings-tabs/SettingsTabNav";
import { ProviderTab } from "./settings-tabs/ProviderTab";
import { SafeModeTab } from "./settings-tabs/SafeModeTab";
import { AboutTab } from "./settings-tabs/AboutTab";

export function SettingsPage(props: { initialTab?: SettingsTab; hideHeader?: boolean } = {}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(props.initialTab ?? "provider");
  const page = useProviderList();

  return (
    <div className={`${props.hideHeader ? "" : "mx-auto max-w-4xl space-y-6 p-4 sm:p-8 "}animate-in fade-in duration-300`}>
      {/* Header */}
      {!props.hideHeader && (
        <div className="border-b border-border/60 pb-5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-500">
            <Cpu className="size-3.5" />
            Konfigurasi Sistem
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Pengaturan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Kelola provider kecerdasan buatan, preferensi RouterOS Safe Mode, dan diagnostik sistem.
          </p>

          {/* Tab Navigation */}
          <SettingsTabNav activeTab={activeTab} onTab={setActiveTab} anyHasKey={page.anyHasKey} />
        </div>
      )}

      {/* Tab 1: Provider AI */}
      {activeTab === "provider" && <ProviderTab page={page} />}

      {/* Tab 2: Safe Mode */}
      {activeTab === "safemode" && <SafeModeTab />}

      {/* Tab 3: About & System */}
      {activeTab === "about" && <AboutTab />}
    </div>
  );
}
