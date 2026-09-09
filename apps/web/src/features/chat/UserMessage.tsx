import { Button } from "@/components/ui/button";
import { FileText, Pencil } from "@/components/icons";
import type { MessageDTO } from "./chat-hooks";
import { CopyButton } from "./CopyButton";
import { EditBox } from "./editing";

export function UserMessage(props: {
  m: MessageDTO;
  isEditing: boolean;
  editingContent: string;
  onEditingChange: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSubmitEdit: () => void;
}) {
  const { m, isEditing } = props;
  return (
    <div>
      {isEditing ? (
        <EditBox
          value={props.editingContent}
          onChange={props.onEditingChange}
          onCancel={props.onCancelEdit}
          onSubmit={props.onSubmitEdit}
        />
      ) : (
        <div className="rounded-2xl rounded-tr-xs bg-indigo-600 px-4 py-3 text-white shadow-sm">
          <p className="whitespace-pre-wrap text-sm leading-relaxed font-normal">{m.content.text}</p>
          {m.content.attachments && m.content.attachments.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {m.content.attachments.map((a) => (
                <span key={a.id} className="flex items-center gap-1 rounded-md bg-white/20 px-2.5 py-0.5 text-xs text-white">
                  <FileText className="size-3" />
                  {a.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {!isEditing && (
        <div className="mt-1 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <CopyButton getText={() => m.content.text ?? ""} label="Salin" />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/80 gap-1 rounded-md transition-colors"
            onClick={props.onStartEdit}
            title="Edit pesan ini"
          >
            <Pencil className="size-3" />
            <span>Edit</span>
          </Button>
        </div>
      )}
    </div>
  );
}
