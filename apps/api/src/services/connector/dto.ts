import type { ConnectorDTO, RouterMode } from "@shared/index";
import type { routerConnections } from "../../db/schema";

export function toDTO(
  row: typeof routerConnections.$inferSelect,
  mode: RouterMode,
  version: number,
): ConnectorDTO {
  return {
    id: row.id,
    label: row.label,
    host: row.host,
    port: row.port,
    username: row.username,
    status: row.status as ConnectorDTO["status"],
    mode,
    modeVersion: version,
    hostKeyFingerprint: row.hostKeyFingerprint,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    routerIdentity: row.routerIdentity,
    rosVersion: row.rosVersion ?? null,
    boardName: row.boardName ?? null,
    architecture: row.architecture ?? null,
    managementInterface: row.managementInterface ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
