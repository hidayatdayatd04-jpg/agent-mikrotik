import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, RefreshCw } from "@/components/icons";

export function ProviderModelField(props: {
  model: string;
  onModelChange: (v: string) => void;
  models: { id: string; label?: string }[] | null;
  fetching: boolean;
  onFetch: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="pv-model">Model</Label>
        <Button type="button" variant="outline" size="sm" onClick={props.onFetch} disabled={props.fetching} className="gap-1.5">
          {props.fetching ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
          {props.fetching ? "Mengambil…" : "Ambil daftar model"}
        </Button>
      </div>
      <Input
        id="pv-model"
        value={props.model}
        onChange={(e) => props.onModelChange(e.target.value)}
        placeholder="contoh: gemini-2.0-flash / openai/gpt-4o-mini / model custom"
        className="font-mono text-xs"
      />
      {props.models && props.models.length > 0 && (
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-1">
          {props.models.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => props.onModelChange(m.id)}
              className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                props.model === m.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              <span className="font-mono">{m.id}</span>
              {m.label && <span className="ml-2 truncate text-[11px] opacity-70">{m.label}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
