import { Plus } from "@/components/icons";

export function ProviderRecommendationChips(props: {
  recommendations: string[];
  models: string[];
  onAdd: (m: string) => void;
}) {
  const { recommendations, models, onAdd } = props;
  if (recommendations.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">Rekomendasi Cepat:</span>
      <div className="flex flex-wrap gap-1.5">
        {recommendations.map((rec) => {
          const alreadyAdded = models.includes(rec);
          return (
            <button
              key={rec}
              type="button"
              onClick={() => onAdd(rec)}
              disabled={alreadyAdded}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors ${
                alreadyAdded
                  ? "border-border/40 bg-muted/40 text-muted-foreground/60 cursor-default"
                  : "border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20"
              }`}
            >
              <Plus className="size-2.5" />
              {rec}
            </button>
          );
        })}
      </div>
    </div>
  );
}
