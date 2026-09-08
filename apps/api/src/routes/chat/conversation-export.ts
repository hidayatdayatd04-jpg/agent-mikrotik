import type { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { AppError } from "../../lib/errors";
import type { Env } from "../../types";
import { agentRuns, messages } from "../../db/schema";
import { redactText } from "../../lib/redaction";
import { requireConversation, requireWorkspace } from "./helpers";
import type { ChatCtx } from "./types";

/** Export transkrip markdown (snapshot read-only, tanpa kredensial). */
export function registerConversationExport(routes: Hono<Env>, ctx: ChatCtx) {
  const { deps } = ctx;

  routes.get("/api/conversations/:id/export", async (c) => {
    const workspace = requireWorkspace(c);
    const conv = await requireConversation(ctx, workspace.userId, c.req.param("id"));
    const url = new URL(c.req.url);
    const format = url.searchParams.get("format") ?? "md";
    if (format !== "md") throw new AppError("VALIDATION_FAILED", "Format export hanya md.", 422);
    // Full transcript from storage (not the 500-row UI window, not the 24-row model window).
    const rows = await deps.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id))
      .orderBy(asc(messages.seq));
    const { activityEvents: activityTable, conversationSummaries: summaryTable, routerConnections: connTable } = await import("../../db/schema");
    const activities = await deps.db
      .select()
      .from(activityTable)
      .where(eq(activityTable.conversationId, conv.id))
      .orderBy(asc(activityTable.seq))
      .limit(1000);
    const summaries = await deps.db
      .select()
      .from(summaryTable)
      .where(eq(summaryTable.conversationId, conv.id))
      .orderBy(asc(summaryTable.version));
    let connectorMeta: string | null = null;
    if (conv.activeConnectionId) {
      const [connRow] = await deps.db.select().from(connTable).where(eq(connTable.id, conv.activeConnectionId)).limit(1);
      if (connRow) connectorMeta = `${connRow.label} (${connRow.host})${connRow.routerIdentity ? ` · ${connRow.routerIdentity}` : ""} · status ${connRow.status}`;
    }
    const activeRun = await deps.db
      .select({ id: agentRuns.id, status: agentRuns.status })
      .from(agentRuns)
      .where(and(eq(agentRuns.conversationId, conv.id), eq(agentRuns.status, "running")))
      .limit(1);
    const safeTitle = conv.title.replace(/[^\p{L}\p{N}\-_ ]+/gu, "").trim().slice(0, 60) || "chat";
    const date = new Date().toISOString().slice(0, 10);
    const fileName = `${safeTitle}-${date}.md`;
    const fenceFor = (text: string): string => {
      let fence = "```";
      while (text.includes(fence)) fence += "`";
      return fence;
    };
    let md = `# ${conv.title}\n\n`;
    md += `- id: ${conv.id}\n- dibuat: ${(conv.createdAt as Date).toISOString()}\n- diubah: ${(conv.updatedAt as Date).toISOString()}\n`;
    if (connectorMeta) md += `- connector: ${connectorMeta} (tanpa kredensial)\n`;
    if (activeRun.length > 0) md += `\n> Catatan: run masih aktif — snapshot sampai seq terakhir, tidak mengeksekusi ulang.\n`;
    md += `\n---\n\n`;
    for (const m of rows) {
      const content = m.content as { text?: string; attachments?: { id: string; name: string; kind: string }[] };
      const ts = (m.createdAt as Date).toISOString();
      md += `## ${m.role === "user" ? "User" : "Assistant"} · seq ${m.seq} · ${ts}\n\n`;
      const text = String(content?.text ?? "");
      if (text.includes("```")) {
        const fence = fenceFor(text);
        md += `${fence}markdown\n${text}\n${fence}\n\n`;
      } else {
        md += `${text}\n\n`;
      }
      if (content?.attachments?.length) {
        md += `Lampiran: ${content.attachments.map((a) => `${a.name} (${a.kind})`).join(", ")} (metadata saja, tanpa signed URL)\n\n`;
      }
    }
    if (summaries.length > 0) {
      md += `\n---\n\n## Catatan compact\n\n`;
      for (const s of summaries) {
        md += `<details><summary>summary v${s.version} · throughSeq ${s.throughSeq}</summary>\n\n${String(s.summary).slice(0, 4000)}\n\n</details>\n\n`;
      }
    }
    if (activities.length > 0) {
      md += `\n---\n\n## Proses tersimpan\n\n`;
      for (const a of activities.slice(0, 200)) {
        const p = a.payload as Record<string, unknown>;
        const label = String((p as { command?: unknown }).command ?? (p as { tool?: unknown }).tool ?? (p as { name?: unknown }).name ?? a.type);
        md += `- [${a.seq}] ${a.type} (${a.actor}): ${redactText(label).slice(0, 200)}\n`;
      }
    }
    return new Response(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName.replace(/["\\]/g, "")}"`,
      },
    });
  });
}
