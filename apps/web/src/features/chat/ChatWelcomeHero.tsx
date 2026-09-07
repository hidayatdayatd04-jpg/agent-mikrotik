import { Activity, ShieldCheck, Wifi, Terminal } from "lucide-react";

interface PromptSuggestion {
  icon: typeof Activity;
  title: string;
  subtitle: string;
  prompt: string;
  tag: string;
}

const SUGGESTIONS: PromptSuggestion[] = [
  {
    icon: Activity,
    title: "Status Interface & Traffic",
    subtitle: "Cek port aktif, status link ether, dan utilisasi bandwidth",
    prompt: "Tampilkan status semua interface, cek port yang running, dan analisa utilisasi bandwidth saat ini.",
    tag: "Monitoring",
  },
  {
    icon: ShieldCheck,
    title: "Audit Keamanan & Firewall",
    subtitle: "Periksa filter rules, brute-force protection, dan port terbuka",
    prompt: "Analisis konfigurasi firewall filter rules dan NAT saya. Apakah ada potensi celah keamanan atau port berbahaya yang terbuka?",
    tag: "Keamanan",
  },
  {
    icon: Wifi,
    title: "Setup Hotspot & Limit Profil",
    subtitle: "Panduan setup hotspot server, user profile, dan rate-limit",
    prompt: "Bagaimana cara konfigurasi hotspot server MikroTik lengkap dengan user profile limit bandwidth download/upload 10M/5M?",
    tag: "Konfigurasi",
  },
  {
    icon: Terminal,
    title: "Diagnostik Ping & DNS",
    subtitle: "Uji latensi gateway, cek cache DNS resolver, dan rute",
    prompt: "Lakukan diagnostik jaringan: uji ping ke gateway dan DNS 1.1.1.1, serta periksa status cache DNS resolver.",
    tag: "Diagnostik",
  },
];

export function ChatWelcomeHero(props: { onSelectPrompt: (prompt: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center animate-in fade-in duration-500">
      {/* Brand Icon Badge with Logo */}
      <div className="relative mb-6">
        <div className="absolute -inset-2 rounded-3xl bg-gradient-to-r from-cyan-500 to-indigo-500 opacity-30 blur-xl animate-pulse" />
        <div className="relative flex size-20 items-center justify-center rounded-3xl border border-cyan-500/40 bg-card p-1.5 shadow-2xl">
          <img src="/logo.png" alt="MikroTik AI" className="size-full object-contain" />
        </div>
        <div className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-emerald-500 shadow-sm ring-2 ring-background" />
      </div>

      {/* Main Title & Tagline */}
      <h1 className="mb-2 text-2xl font-bold tracking-tight sm:text-3xl">
        MikroTik AI Agent
      </h1>
      <p className="max-w-md text-sm text-muted-foreground sm:text-base">
        Asisten pintar untuk otomasi konfigurasi, monitoring live traffic, audit keamanan, dan diagnostik RouterOS.
      </p>

      {/* Suggestion Cards Grid */}
      <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2 text-left">
        {SUGGESTIONS.map((item, idx) => {
          const Icon = item.icon;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => props.onSelectPrompt(item.prompt)}
              className="group relative flex flex-col justify-between rounded-xl border border-border/70 bg-card/60 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-500/40 hover:bg-card hover:shadow-md hover:shadow-indigo-500/5 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            >
              <div>
                <div className="mb-2.5 flex items-center justify-between">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 transition-colors group-hover:bg-indigo-500 group-hover:text-white dark:bg-indigo-400/10 dark:text-indigo-400 dark:group-hover:bg-indigo-500 dark:group-hover:text-white">
                    <Icon className="size-4" />
                  </div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground group-hover:text-foreground">
                    {item.tag}
                  </span>
                </div>
                <h2 className="text-sm font-semibold tracking-tight text-foreground transition-colors group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                  {item.title}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                  {item.subtitle}
                </p>
              </div>
              <div className="mt-3 flex items-center text-[11px] font-medium text-indigo-600 opacity-0 transition-opacity group-hover:opacity-100 dark:text-indigo-400">
                Gunakan saran ini →
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
