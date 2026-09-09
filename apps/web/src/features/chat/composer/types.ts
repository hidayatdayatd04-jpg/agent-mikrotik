import type { AttachmentDTO } from "../chat-hooks";
import type { ConnectorDTO } from "@shared/index";

export interface ChatComposerProps {
  disabled?: boolean;
  running: boolean;
  cancelling?: boolean;
  conversationId?: string;
  connector?: ConnectorDTO | null;
  connectors?: ConnectorDTO[];
  selectedConnectorId?: string | null;
  onSelectConnector?: (id: string) => void;
  attachments: AttachmentDTO[];
  uploading: boolean;
  externalText?: string;
  onClearExternalText?: () => void;
  onPickFile: (file: File) => void;
  onRemoveAttachment: (id: string) => void;
  onSend: (text: string, attachmentIds: string[], model?: string, providerId?: string) => void;
  onCancel: () => void;
  onAddRouter?: () => void;
  onCompact?: () => void;
  draftKey?: string;
}
