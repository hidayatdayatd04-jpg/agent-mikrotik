import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Send, X } from "@/components/icons";

export function useMessageEditing() {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>("");

  function startEdit(id: string, text: string) {
    setEditingMessageId(id);
    setEditingContent(text);
  }

  function cancelEdit() {
    setEditingMessageId(null);
  }

  return { editingMessageId, editingContent, setEditingContent, startEdit, cancelEdit };
}

export function EditBox(props: {
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="rounded-2xl border border-indigo-500/80 bg-card p-3 shadow-md space-y-2">
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full min-h-[70px] resize-none bg-transparent p-1 text-sm outline-none text-foreground"
        autoFocus
      />
      <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/60">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={props.onCancel}>
          <X className="size-3 mr-1" /> Batal
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs bg-indigo-600 hover:bg-indigo-500 text-white gap-1"
          onClick={props.onSubmit}
          disabled={!props.value.trim()}
        >
          <Send className="size-3" /> Kirim Ulang
        </Button>
      </div>
    </div>
  );
}
