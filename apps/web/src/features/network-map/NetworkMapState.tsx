import { Button } from "@/components/ui/button";
import { Network, Loader2, Plug } from "@/components/icons";
import { navigate } from "@/lib/router";

export function ConnectorLink() {
  return (
    <Button variant="outline" size="sm" onClick={() => navigate({ name: "settings", section: "connectors" })}>
      <Plug className="size-4" />
      Buka Connector
    </Button>
  );
}

export function MapState({
  title,
  description,
  loading,
  children,
}: {
  title: string;
  description?: string;
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="map-state" role="status" aria-live="polite">
      <div className="map-state-symbol">{loading ? <Loader2 className="size-7 animate-spin" /> : <Network className="size-7" />}</div>
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="max-w-md text-center text-sm leading-relaxed text-muted-foreground">{description}</p>}
      <div className="flex flex-wrap justify-center gap-2">{children}</div>
    </div>
  );
}
