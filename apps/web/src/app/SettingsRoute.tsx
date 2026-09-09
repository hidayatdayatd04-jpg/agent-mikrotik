import { Toaster } from "sonner";
import { SettingsShell } from "../features/settings/SettingsShell";
import { navigate } from "../lib/router";

export function SettingsRoute(props: { section: string }) {
  const params = new URLSearchParams(window.location.search);
  const autoAdd = params.get("add") === "1";
  const returnTo = params.get("returnTo");
  return (
    <div className="flex h-svh w-full overflow-hidden bg-background text-foreground">
      <SettingsShell
        section={props.section}
        autoAdd={autoAdd}
        returnTo={returnTo}
        onUseInChat={(id) => {
          if (returnTo) {
            try {
              sessionStorage.setItem("pending-connector", id);
            } catch {
              /* ignore */
            }
            window.location.href = returnTo;
          }
        }}
        onBack={() => {
          if (returnTo) window.location.href = returnTo;
          else navigate({ name: "chat-new" });
        }}
      />
      <Toaster position="top-center" richColors />
    </div>
  );
}
