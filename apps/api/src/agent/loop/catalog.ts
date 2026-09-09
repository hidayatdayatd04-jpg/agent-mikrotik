import type { ChatToolDefinition } from "../chat-client";
import type { NormalizedTool } from "../../policies/normalize";
import { isGreetingOnly } from "../intent";
import { CONNECTION_CHECK_FQ, CONNECTION_CHECK_TOOL } from "./connection";
import { toProviderTools } from "./provider-tools";
import { selectRelevantTools } from "./ranking";
import type { StartRunInput } from "./types";

export interface RunCatalog {
  greetingOnly: boolean;
  catalog: NormalizedTool[];
  providerTools: ChatToolDefinition[];
}

/**
 * no router bound → documentation tools only; router tools would fail
 * ownership checks anyway and waste a provider turn.
 * The connection probe is always offered — it is how the model verifies
 * live status instead of trusting (or refusing) chat claims.
 */
export async function buildRunCatalog(
  catalogSource: { getCatalog(mode: "read-only" | "write"): Promise<NormalizedTool[]> },
  input: StartRunInput,
): Promise<RunCatalog> {
  const greetingOnly = isGreetingOnly(input.userText);
  const fullCatalog = greetingOnly ? [] : [...(await catalogSource.getCatalog(input.policy.mode)), CONNECTION_CHECK_TOOL];
  const catalog = input.connectionId
    ? fullCatalog
    : fullCatalog.filter((t) => t.fqName.startsWith("docs:") || t.fqName.startsWith("web:") || t.fqName === CONNECTION_CHECK_FQ);
  const providerTools = toProviderTools(selectRelevantTools(catalog, input.userText), input.userText);
  return { greetingOnly, catalog, providerTools };
}
