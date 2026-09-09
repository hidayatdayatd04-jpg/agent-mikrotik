import { createCustomIcon } from "./base";
import { Check, CheckCircle2 } from "./base";
import { ChevronRight } from "./icons-a";
import { Info, Loader2 } from "./icons-b";
import { PanelLeftClose } from "./icons-c";

/* 57. TerminalSquare / CLI Workstation Dock */
export const TerminalSquare = createCustomIcon("TerminalSquare", (
  <>
    <rect x="3" y="3.5" width="18" height="17" rx="3" />
    <path d="m7.5 9.5 3 2.5-3 2.5" />
    <line x1="13" y1="15.5" x2="16.5" y2="15.5" />
  </>
));

/* 58. Trash2 / Delete Entity */
export const Trash2 = createCustomIcon("Trash2", (
  <>
    <line x1="3.5" y1="6.5" x2="20.5" y2="6.5" />
    <path d="M9 6.5V4.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4.5v2" />
    <path d="M5.5 6.5l1.2 13a2 2 0 0 0 2 1.8h6.6a2 2 0 0 0 2-1.8l1.2-13" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </>
));

/* 59. User / Authenticated Operator Profile */
export const User = createCustomIcon("User", (
  <>
    <circle cx="12" cy="7.5" r="4.2" />
    <path d="M4.5 20.5c0-4 3.5-6.5 7.5-6.5s7.5 2.5 7.5 6.5" />
  </>
));

/* 60. Wifi / Wireless Radio Network */
export const Wifi = createCustomIcon("Wifi", (
  <>
    <circle cx="12" cy="18.5" r="1.2" fill="currentColor" stroke="none" />
    <path d="M8.5 14.5a5 5 0 0 1 7 0" />
    <path d="M5 10.5a10 10 0 0 1 14 0" />
    <path d="M2 6.8a14.5 14.5 0 0 1 20 0" />
  </>
));

/* 61. X / Dismiss Cross */
export const X = createCustomIcon("X", (
  <>
    <line x1="18.5" y1="5.5" x2="5.5" y2="18.5" />
    <line x1="5.5" y1="5.5" x2="18.5" y2="18.5" />
  </>
));

/* 62. XCircle / Error Container */
export const XCircle = createCustomIcon("XCircle", (
  <>
    <circle cx="12" cy="12" r="9.5" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </>
));

/* 63. OctagonXIcon / Critical Alert */
export const OctagonXIcon = createCustomIcon("OctagonXIcon", (
  <>
    <polygon points="7.8 2.5 16.2 2.5 21.5 7.8 21.5 16.2 16.2 21.5 7.8 21.5 2.5 16.2 2.5 7.8 7.8 2.5" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </>
));

/* 64. TriangleAlertIcon / Hazard Alert */
export const TriangleAlertIcon = createCustomIcon("TriangleAlertIcon", (
  <>
    <path d="M12 3.2 2.2 19.8A1.8 1.8 0 0 0 3.75 22.5h16.5a1.8 1.8 0 0 0 1.55-2.7L12 3.2Z" />
    <line x1="12" y1="9.5" x2="12" y2="14.5" />
    <circle cx="12" cy="18" r="0.9" fill="currentColor" stroke="none" />
  </>
));

/* Convenience aliases for UI libraries & backwards compatibility */
export const CheckIcon = Check;
export const ChevronRightIcon = ChevronRight;
export const CircleCheckIcon = CheckCircle2;
export const InfoIcon = Info;
export const Loader2Icon = Loader2;
export const PanelLeftIcon = PanelLeftClose;
export const XIcon = X;
