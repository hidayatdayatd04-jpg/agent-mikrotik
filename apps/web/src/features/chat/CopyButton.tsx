import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "@/components/icons";

export function CopyButton({ getText, label = "Salin" }: { getText: () => string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/80 gap-1.5 rounded-md transition-colors"
      aria-label="Salin teks"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(getText());
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? (
        <>
          <Check className="size-3.5 text-emerald-500" aria-hidden />
          <span className="text-emerald-500 font-medium">Tersalin!</span>
        </>
      ) : (
        <>
          <Copy className="size-3.5" aria-hidden />
          <span>{label}</span>
        </>
      )}
    </Button>
  );
}
