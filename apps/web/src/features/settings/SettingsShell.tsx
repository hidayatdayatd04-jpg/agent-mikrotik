import { ArrowLeft, Plug, Key, User, Palette, Database, ShieldCheck, Archive, Info, HelpCircle, Globe } from "@/components/icons";
import { ConnectorsPanel } from "@/features/connectors/ConnectorsPanel";
import { Button } from "@/components/ui/button";
import { navigate } from "@/lib/router";
import { ProvidersSection } from "./sections/ProvidersSection";
import { ProfileSection } from "./sections/ProfileSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { ContextSection } from "./sections/ContextSection";
import { SecuritySection } from "./sections/SecuritySection";
import { ArchiveSection } from "./sections/ArchiveSection";
import { AboutSection } from "./sections/AboutSection";
import { HelpSection } from "./sections/HelpSection";
import { WebSearchSection } from "./sections/WebSearchSection";

const NAV = [
  { id: "connectors", label: "Connector Router", icon: Plug },
  { id: "providers", label: "Provider AI", icon: Key },
  { id: "web-search", label: "Deep Research", icon: Globe },
  { id: "profile", label: "Profil", icon: User },
  { id: "appearance", label: "Tampilan", icon: Palette },
  { id: "context", label: "Konteks", icon: Database },
  { id: "security", label: "Keamanan & Safe Mode", icon: ShieldCheck },
  { id: "archive", label: "Arsip", icon: Archive },
  { id: "about", label: "Tentang", icon: Info },
  { id: "help", label: "Bantuan", icon: HelpCircle },
];

export function SettingsShell(props: {
  section: string;
  returnTo?: string | null;
  autoAdd?: boolean;
  onUseInChat?: (id: string) => void;
  onBack: () => void;
}) {
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
            {section === "web-search" && <WebSearchSection />}
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
