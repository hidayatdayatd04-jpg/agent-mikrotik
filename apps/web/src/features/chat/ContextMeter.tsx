import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useProviderSettings } from "./chat-hooks";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from "@/components/ui/dropdown-menu";

interface ModelContext {
  model: string;
  modelLabel: string;
  contextWindow: number | null;
  contextBasis: "input" | "total" | null;
}
interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  lastRequestInputTokens?: number;
  lastRequestOutputTokens?: number;
  aiRequests?: number;
  toolCalls?: number;
  modelLabel?: string;
  source?: string;
}
const number = new Intl.NumberFormat("id-ID");

export function ContextMeter({ conversationId, running }: { conversationId?: string; running: boolean }) {
  const provider = useProviderSettings();
  const metadata = useQuery({
    queryKey: ["ai-provider", "context", provider.data?.model, provider.data?.baseUrl],
    enabled: !!provider.data,
    queryFn: () => apiFetch<{ context: ModelContext | null }>("/api/ai-provider/context"),
    staleTime: 300_000, retry: 1,
  });
  const snapshot = useQuery({
    queryKey: ["context", conversationId],
    enabled: !!conversationId,
    queryFn: () => apiFetch<{ usage: Usage | null }>(`/api/conversations/${conversationId}/context`),
    refetchInterval: running ? 2000 : false,
  });
  const model = metadata.data?.context;
  const usage = snapshot.data?.usage;
  const measured = usage?.source === "provider" && usage.modelLabel === model?.modelLabel && typeof usage.promptTokens === "number";
  const activeInputTokens = typeof usage?.lastRequestInputTokens === "number" && usage.lastRequestInputTokens > 0
    ? usage.lastRequestInputTokens
    : usage?.promptTokens;
  const activeOutputTokens = typeof usage?.lastRequestOutputTokens === "number" && usage.lastRequestOutputTokens > 0
    ? usage.lastRequestOutputTokens
    : usage?.completionTokens;
  const used = measured && typeof activeInputTokens === "number"
    ? activeInputTokens + (model?.contextBasis === "total" ? (activeOutputTokens ?? 0) : 0)
    : null;
  const capacity = model?.contextWindow;
  const percent = used !== null && capacity ? used / capacity * 100 : null;
  const percentLabel = percent === null ? null : new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(percent);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Pemakaian context window" className="flex h-8 items-center gap-2 rounded-lg px-2 text-[11px] text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <svg width="16" height="16" viewBox="0 0 20 20" className={percent !== null && percent >= 90 ? "text-amber-500" : "text-muted-foreground"} aria-hidden="true">
            <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2" />
            {percent !== null && <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={`${Math.min(percent, 100) * .44} 44`} transform="rotate(-90 10 10)" strokeLinecap="round" />}
          </svg>
          <span>Konteks {percentLabel !== null ? `${percentLabel}%` : "—"}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" sideOffset={12} className="w-72 p-4 text-xs">
        <p className="mb-3 break-all font-medium">{model?.model ?? provider.data?.model ?? "Provider belum diatur"}</p>
        <div className="space-y-2 text-muted-foreground">
          <p className="flex justify-between gap-3"><span>Request AI (run terakhir)</span><span className="font-mono text-foreground">{typeof usage?.aiRequests === "number" ? number.format(usage.aiRequests) : "—"}</span></p>
          <p className="flex justify-between gap-3"><span>Tool dipanggil</span><span className="font-mono text-foreground">{typeof usage?.toolCalls === "number" ? number.format(usage.toolCalls) : "—"}</span></p>
          <p className="flex justify-between gap-3"><span>Kapasitas {model?.contextBasis === "input" ? "input" : "konteks"}</span><span className="font-mono text-foreground">{capacity ? `${number.format(capacity)} token` : "Belum tersedia"}</span></p>
          <p className="flex justify-between gap-3"><span>Input (request terakhir)</span><span className="font-mono text-foreground">{measured ? number.format(activeInputTokens!) : "—"}</span></p>
          <p className="flex justify-between gap-3"><span>Output (request terakhir)</span><span className="font-mono text-foreground">{measured && typeof activeOutputTokens === "number" ? number.format(activeOutputTokens) : "—"}</span></p>
          {usage?.aiRequests && usage.aiRequests > 1 && (
            <p className="flex justify-between gap-3 text-[11px] opacity-75"><span>Total input kumulatif</span><span className="font-mono">{measured && typeof usage?.promptTokens === "number" ? number.format(usage.promptTokens) : "—"}</span></p>
          )}
          <p className="border-t border-border pt-3 leading-relaxed">{measured ? "Hitungan asli dari provider untuk permintaan terakhir, termasuk instruksi dan tool. Diperbarui saat provider melaporkan usage." : "Pemakaian belum dilaporkan provider. Angka tidak diperkirakan dari panjang teks."}</p>
          {metadata.isError && <p>Metadata model belum dapat diambil.</p>}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
