import { PROVIDER_KINDS } from "./use-provider-settings-form";

export function ProviderKindGrid(props: { kind: string; onPick: (id: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {PROVIDER_KINDS.map((k) => (
        <button
          key={k.id}
          type="button"
          onClick={() => props.onPick(k.id)}
          className={`rounded-xl border p-3 text-left transition-colors ${
            props.kind === k.id ? "border-ring bg-muted/60" : "hover:bg-muted/40"
          }`}
          aria-pressed={props.kind === k.id}
        >
          <span className="block text-sm font-medium">{k.label}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{k.hint}</span>
        </button>
      ))}
    </div>
  );
}
