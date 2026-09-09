import { useEffect, useState } from "react";
import { useConnectors, useDiscoverConnectors, type DiscoveredRouterDTO } from "./connector-hooks";
import { ConnectorDialog } from "./ConnectorDialog";
import { ConnectorsHeader } from "./ConnectorsHeader";
import { DiscoverySection } from "./DiscoverySection";
import { RoutersList } from "./RoutersList";

export function ConnectorsPanel(
  props: { autoOpenAdd?: boolean; returnTo?: string | null; onUseInChat?: (id: string) => void } = {},
) {
  const { data: connectors, isLoading, error, refetch } = useConnectors();
  const discovery = useDiscoverConnectors();
  const [dialogOpen, setDialogOpen] = useState(!!props.autoOpenAdd);
  useEffect(() => {
    if (props.autoOpenAdd) setDialogOpen(true);
  }, [props.autoOpenAdd]);
  const [prefillValues, setPrefillValues] = useState<{
    label?: string;
    host?: string;
    port?: number;
    username?: string;
  } | null>(null);

  const totalCount = (connectors ?? []).length;
  const connectedCount = (connectors ?? []).filter((c) => c.status === "connected").length;

  function handleOpenManual() {
    setPrefillValues(null);
    setDialogOpen(true);
  }

  function handleConnectDiscovered(dev: DiscoveredRouterDTO) {
    const targetIp = dev.ipv4 || dev.ip;
    setPrefillValues({
      label: `MikroTik ${dev.identity || "CHR"} (${targetIp})`,
      host: targetIp,
      port: 22,
      username: "admin",
    });
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <ConnectorsHeader totalCount={totalCount} connectedCount={connectedCount} onAdd={handleOpenManual} />

      {/* AUTO-DISCOVERY SECTION (MikroTik MNDP / Neighbors) */}
      <DiscoverySection discovery={discovery} onConnect={handleConnectDiscovered} />

      {/* Routers List */}
      <RoutersList
        connectors={connectors}
        isLoading={isLoading}
        error={error}
        returnTo={props.returnTo}
        onUseInChat={props.onUseInChat}
        onRefetch={() => void refetch()}
        onAdd={() => setDialogOpen(true)}
      />

      <ConnectorDialog open={dialogOpen} onOpenChange={setDialogOpen} initialValues={prefillValues} />
    </div>
  );
}
