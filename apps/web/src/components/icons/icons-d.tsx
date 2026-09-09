import { createCustomIcon } from "./base";

/* 45. RefreshCw / Sync & Live Refresh */
export const RefreshCw = createCustomIcon("RefreshCw", (
  <>
    <path d="M21 11.5a9 9 0 0 0-15.5-5.5L3 8.5" />
    <polyline points="3 3.5 3 8.5 8 8.5" />
    <path d="M3 12.5a9 9 0 0 0 15.5 5.5l2.5-2.5" />
    <polyline points="21 20.5 21 15.5 16 15.5" />
  </>
));

/* 46. RotateCcw / Re-run & Undo */
export const RotateCcw = createCustomIcon("RotateCcw", (
  <>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L2 10" />
    <polyline points="2 4.5 2 10 7.5 10" />
  </>
));

/* 47. Scissors / Context Trimming & Pruning */
export const Scissors = createCustomIcon("Scissors", (
  <>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="m8.2 8.2 13.3 13.3" />
    <path d="m8.2 15.8 13.3-13.3" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
  </>
));

/* 48. Search / Query Filter */
export const Search = createCustomIcon("Search", (
  <>
    <circle cx="10.5" cy="10.5" r="7.5" />
    <line x1="16" y1="16" x2="21.5" y2="21.5" />
  </>
));

/* 49. Send / Command Transmission Dart */
export const Send = createCustomIcon("Send", (
  <>
    <path d="M21.5 2.5 10 14" />
    <path d="m21.5 2.5-6.5 19-4.5-8-8-4.5 19-6.5Z" />
  </>
));

/* 50. Server / Dual Rackmount Chassis with Status LEDs */
export const Server = createCustomIcon("Server", (
  <>
    <rect x="2.5" y="3" width="19" height="7.5" rx="2" />
    <line x1="6.5" y1="6.75" x2="13.5" y2="6.75" />
    <circle cx="17.5" cy="6.75" r="1" fill="currentColor" stroke="none" />
    <rect x="2.5" y="13.5" width="19" height="7.5" rx="2" />
    <line x1="6.5" y1="17.25" x2="13.5" y2="17.25" />
    <circle cx="17.5" cy="17.25" r="1" fill="currentColor" stroke="none" />
  </>
));

/* 51. Settings / System Configuration Engine */
export const Settings = createCustomIcon("Settings", (
  <>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </>
));

/* 52. Settings2 / Multi-Channel Equalizer Faders */
export const Settings2 = createCustomIcon("Settings2", (
  <>
    <line x1="5" y1="21" x2="5" y2="3" />
    <circle cx="5" cy="14" r="2.2" fill="currentColor" stroke="none" />
    <line x1="12" y1="21" x2="12" y2="3" />
    <circle cx="12" cy="8" r="2.2" fill="currentColor" stroke="none" />
    <line x1="19" y1="21" x2="19" y2="3" />
    <circle cx="19" cy="16" r="2.2" fill="currentColor" stroke="none" />
  </>
));

/* 53. ShieldCheck / Firewall & Verified Armor */
export const ShieldCheck = createCustomIcon("ShieldCheck", (
  <>
    <path d="M12 2.5 4.5 5.5v6.5c0 5.5 3.5 9.5 7.5 10.5 4-1 7.5-5 7.5-10.5V5.5L12 2.5Z" />
    <path d="m8.5 11.5 2.5 2.5 5-5" />
  </>
));

/* 54. Square / Execution Stop Control */
export const Square = createCustomIcon("Square", (
  <>
    <rect x="4.5" y="4.5" width="15" height="15" rx="3" />
  </>
));

/* 55. Sun / Light Mode Luminary */
export const Sun = createCustomIcon("Sun", (
  <>
    <circle cx="12" cy="12" r="4.2" />
    <line x1="12" y1="2" x2="12" y2="4.5" />
    <line x1="12" y1="19.5" x2="12" y2="22" />
    <line x1="2" y1="12" x2="4.5" y2="12" />
    <line x1="19.5" y1="12" x2="22" y2="12" />
    <line x1="4.9" y1="4.9" x2="6.8" y2="6.8" />
    <line x1="17.2" y1="17.2" x2="19.1" y2="19.1" />
    <line x1="4.9" y1="19.1" x2="6.8" y2="17.2" />
    <line x1="17.2" y1="6.8" x2="19.1" y2="4.9" />
  </>
));

/* 56. Terminal / RouterOS CLI Shell Prompt */
export const Terminal = createCustomIcon("Terminal", (
  <>
    <path d="m4.5 7.5 5 4.5-5 4.5" />
    <line x1="12" y1="17" x2="19.5" y2="17" />
  </>
));
