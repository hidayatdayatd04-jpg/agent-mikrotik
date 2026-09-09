import { ChevronDown, Check, Search, Settings2 } from "@/components/icons";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ModelLimitIndicator } from "../ModelLimitIndicator";
import { ProviderLogo, providerLogoId } from "../provider-logos";
import type { ComposerModel } from "./use-composer-model";
import type { ModelScroll } from "./use-model-scroll";

export function ModelPicker(props: { model: ComposerModel; scroll: ModelScroll }) {
  const { model } = props;
  const { scroll } = props;
  const { effectiveModel, effectiveSelection, effectiveProvider, enabledProviders, modelQuery } = model;
  if (model.availableModels.length === 0) return null;
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        model.setModelMenuOpen(open);
        if (!open) model.setModelQuery("");
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-xl border border-border/70 bg-muted/40 px-2.5 py-1 text-xs text-foreground hover:bg-muted focus-visible:outline-none transition-colors max-w-[190px] cursor-pointer"
          title={`${effectiveProvider?.name ?? ""} / ${effectiveModel}`}
          aria-label="Pilih model AI"
        >
          <ProviderLogo
            logoId={providerLogoId({ kind: effectiveProvider?.kind, id: effectiveProvider?.id, name: effectiveProvider?.name })}
            alt={effectiveProvider?.name ?? "model"}
          />
          <span className="truncate text-[11px] font-medium">
            {effectiveProvider?.name} / {effectiveModel || "Pilih model"}
          </span>
          <ChevronDown className="size-3 text-muted-foreground shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-80 overflow-hidden rounded-2xl border border-border/60 bg-popover bg-clip-padding p-0 shadow-xl ring-0">
        <div className="p-2 pb-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
            <input
              value={modelQuery}
              onChange={(e) => model.setModelQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") e.stopPropagation();
              }}
              placeholder="Search models"
              aria-label="Cari model"
              className="h-9 w-full rounded-xl bg-muted/50 pl-8.5 pr-2 text-xs outline-none placeholder:text-muted-foreground/60 transition-colors"
            />
          </div>
        </div>
        <div className="relative px-1">
          <div
            ref={scroll.modelScrollRef}
            onScroll={scroll.updateModelThumb}
            className="max-h-56 overflow-y-auto pl-1 pr-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {(() => {
              const mq = modelQuery.trim().toLowerCase();
              const groups = enabledProviders
                .map((p) => ({ p, models: mq ? (p.models || []).filter((m) => m.toLowerCase().includes(mq)) : p.models || [] }))
                .filter((g) => g.models.length > 0);
              if (groups.length === 0) {
                return <p className="px-2.5 py-4 text-center text-xs text-muted-foreground">Tidak ada model yang cocok.</p>;
              }
              return groups.map(({ p, models }) => {
                const providerLogo = providerLogoId(p);
                return (
                  <div key={p.id} className="mt-2.5 first:mt-1">
                    <div className="flex items-center gap-2 px-2.5 pt-1 pb-2">
                      <ProviderLogo logoId={providerLogo} alt={p.name} />
                      <span className="truncate text-[11px] font-semibold tracking-wide text-muted-foreground">{p.name}</span>
                      <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                        {models.length}
                      </span>
                    </div>
                    {models.map((m) => {
                      const isSelected = m === effectiveModel && p.id === effectiveSelection?.providerId;
                      return (
                        <DropdownMenuItem
                          key={m}
                          onSelect={() => model.selectModel(p.id, m)}
                          className={`group mt-1 flex items-center justify-between gap-2 rounded-xl px-2.5 py-2.5 text-[13px] transition-colors cursor-pointer select-none ${
                            isSelected
                              ? "bg-indigo-500/10 font-medium text-indigo-600 dark:text-indigo-400"
                              : "text-foreground/90 hover:bg-muted"
                          }`}
                        >
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="truncate">{m}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <ModelLimitIndicator data={p.modelLimits?.[m]} compact />
                            {isSelected && <Check className="size-4 shrink-0" />}
                          </span>
                        </DropdownMenuItem>
                      );
                    })}
                  </div>
                );
              });
            })()}
          </div>
          <div
            ref={scroll.modelTrackRef}
            onPointerDown={scroll.onModelTrackPointerDown}
            className={`absolute right-0.5 top-1 bottom-1 flex w-2 justify-center rounded-full ${scroll.modelThumb.visible ? "cursor-pointer" : "pointer-events-none"}`}
            aria-hidden="true"
          >
            {scroll.modelThumb.visible && (
              <div
                onPointerDown={scroll.onModelThumbPointerDown}
                style={{ top: scroll.modelThumb.top, height: scroll.modelThumb.height }}
                className="absolute w-1 rounded-full bg-foreground/15 transition-colors hover:bg-foreground/30"
              />
            )}
          </div>
        </div>
        <div className="border-t border-border/60 p-1.5">
          <DropdownMenuItem
            onSelect={model.goManageModels}
            className="group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm cursor-pointer select-none text-foreground/90 hover:bg-muted"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10">
              <Settings2 className="size-4 text-indigo-600 dark:text-indigo-400" />
            </span>
            <span className="font-medium">Manage models</span>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
