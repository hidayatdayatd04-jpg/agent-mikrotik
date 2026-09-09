import { createCustomIcon } from "./base";

/* 33. MoreHorizontal / Option Menu Items */
export const MoreHorizontal = createCustomIcon("MoreHorizontal", (
  <>
    <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </>
));

/* 34. MoreVertical / Action Menu Options */
export const MoreVertical = createCustomIcon("MoreVertical", (
  <>
    <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
  </>
));

/* 35. Palette / Appearance & Custom Themes */
export const Palette = createCustomIcon("Palette", (
  <>
    <path d="M12 3C7 3 3 7 3 12c0 4.5 3.5 8 8 8 1 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.8-.5-1.3 0-1 1-1.9 2-1.9h2c3.3 0 6-2.7 6-6 0-4.8-4-8.8-9-8.8Z" />
    <circle cx="7.5" cy="10" r="1" fill="currentColor" stroke="none" />
    <circle cx="11.5" cy="7" r="1" fill="currentColor" stroke="none" />
    <circle cx="16.5" cy="9" r="1" fill="currentColor" stroke="none" />
  </>
));

/* 36. PanelLeftClose / Collapse Sidebar */
export const PanelLeftClose = createCustomIcon("PanelLeftClose", (
  <>
    <rect x="3" y="3.5" width="18" height="17" rx="3" />
    <line x1="9.5" y1="3.5" x2="9.5" y2="20.5" />
    <polyline points="16 14.5 13.5 12 16 9.5" />
  </>
));

/* 37. PanelLeftOpen / Expand Sidebar */
export const PanelLeftOpen = createCustomIcon("PanelLeftOpen", (
  <>
    <rect x="3" y="3.5" width="18" height="17" rx="3" />
    <line x1="9.5" y1="3.5" x2="9.5" y2="20.5" />
    <polyline points="13.5 14.5 16 12 13.5 9.5" />
  </>
));

/* 38. Pencil / Edit & Rename */
export const Pencil = createCustomIcon("Pencil", (
  <>
    <path d="M3.5 20.5l3.8-.9L19.2 7.7a2.1 2.1 0 0 0 0-3l-1.9-1.9a2.1 2.1 0 0 0-3 0L2.4 14.7l1.1 5.8Z" />
    <line x1="12.5" y1="4.5" x2="17.5" y2="9.5" />
  </>
));

/* 39. Pin / Pin Conversation to Top */
export const Pin = createCustomIcon("Pin", (
  <>
    <line x1="12" y1="17.5" x2="12" y2="22" />
    <path d="M5.5 17.5h13l-1.5-6.5V5h1a1 1 0 0 0 0-2H6a1 1 0 0 0 0 2h1v6L5.5 17.5Z" />
  </>
));

/* 40. PinOff / Unpin Conversation */
export const PinOff = createCustomIcon("PinOff", (
  <>
    <line x1="2" y1="2" x2="22" y2="22" />
    <line x1="12" y1="17.5" x2="12" y2="22" />
    <path d="M8.5 8.5l-3 9h12" />
    <path d="M16.5 11l.5-6h1a1 1 0 0 0 0-2H7.5" />
  </>
));

/* 41. Plug / RouterOS Connector Link */
export const Plug = createCustomIcon("Plug", (
  <>
    <line x1="8.5" y1="2" x2="8.5" y2="6.5" />
    <line x1="15.5" y1="2" x2="15.5" y2="6.5" />
    <path d="M6 6.5h12v4.5a6 6 0 0 1-5 5.9V22h-2v-5.1A6 6 0 0 1 6 11V6.5Z" />
  </>
));

/* 42. Plus / Add New Entity */
export const Plus = createCustomIcon("Plus", (
  <>
    <line x1="12" y1="4.5" x2="12" y2="19.5" />
    <line x1="4.5" y1="12" x2="19.5" y2="12" />
  </>
));

/* 43. Power / System Standby Switch */
export const Power = createCustomIcon("Power", (
  <>
    <path d="M18.3 6.8a8.5 8.5 0 1 1-12.6 0" />
    <line x1="12" y1="2.5" x2="12" y2="12" />
  </>
));

/* 44. Radio / Wireless Transmitter Station */
export const Radio = createCustomIcon("Radio", (
  <>
    <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
    <path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6" />
    <path d="M15.8 8.2a5.4 5.4 0 0 1 0 7.6" />
    <path d="M5.4 5.4a9.4 9.4 0 0 0 0 13.2" />
    <path d="M18.6 5.4a9.4 9.4 0 0 1 0 13.2" />
  </>
));
