/* Handcrafted Custom Modern Icons for MikroTik AI Agent */
import React, { forwardRef, type SVGProps } from "react";

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
}

function createCustomIcon(name: string, content: React.ReactNode) {
  const Component = forwardRef<SVGSVGElement, IconProps>(({ size, className, style, ...props }, ref) => {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        width={size}
        height={size}
        className={className || "size-4"}
        style={style}
        aria-hidden="true"
        {...props}
      >
        {content}
      </svg>
    );
  });
  Component.displayName = name;
  return Component;
}

/* 1. Activity / Live Telemetry Wave */
export const Activity = createCustomIcon("Activity", (
  <>
    <path d="M2.5 12h4l2.5-6.5 5 13 3-8.5 2 4H21.5" />
    <circle cx="9" cy="5.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="14" cy="18.5" r="1" fill="currentColor" stroke="none" />
  </>
));

/* 2. AlertCircle / Warning Notice */
export const AlertCircle = createCustomIcon("AlertCircle", (
  <>
    <circle cx="12" cy="12" r="9.5" />
    <line x1="12" y1="7.5" x2="12" y2="12.5" />
    <circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none" />
  </>
));

/* 3. Archive / Storage Vault */
export const Archive = createCustomIcon("Archive", (
  <>
    <rect x="3" y="3.5" width="18" height="4.5" rx="1.5" />
    <path d="M4.5 8v10.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8" />
    <path d="M10 12.5h4" />
  </>
));

/* 4. ArrowDown / Downward Direction */
export const ArrowDown = createCustomIcon("ArrowDown", (
  <>
    <line x1="12" y1="4.5" x2="12" y2="19.5" />
    <polyline points="6 14 12 19.5 18 14" />
  </>
));

/* 5. ArrowLeft / Back Navigation */
export const ArrowLeft = createCustomIcon("ArrowLeft", (
  <>
    <line x1="19.5" y1="12" x2="4.5" y2="12" />
    <polyline points="10 6.5 4.5 12 10 17.5" />
  </>
));

/* 6. Check / Verified Task */
export const Check = createCustomIcon("Check", (
  <>
    <polyline points="4.5 12.5 9.5 17.5 19.5 6.5" />
  </>
));

/* 7. CheckCircle2 / Success Status Badge */
export const CheckCircle2 = createCustomIcon("CheckCircle2", (
  <>
    <circle cx="12" cy="12" r="9.5" />
    <path d="m8 12.5 2.75 2.75 5.5-6.5" />
  </>
));

/* 8. Clock / Chronograph & Timestamp */
export const Clock = createCustomIcon("Clock", (
  <>
    <circle cx="12" cy="12" r="9.5" />
    <polyline points="12 6.5 12 12 15.5 14" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
  </>
));

/* 9. Copy / Duplicate Clipboard */
export const Copy = createCustomIcon("Copy", (
  <>
    <path d="M8 4.5A2 2 0 0 1 10 2.5h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-1" />
    <rect x="4" y="7.5" width="12" height="13" rx="2" />
    <line x1="7.5" y1="12" x2="12.5" y2="12" />
    <line x1="7.5" y1="15.5" x2="11" y2="15.5" />
  </>
));

/* 10. ChevronDown / Collapse Caret */
export const ChevronDown = createCustomIcon("ChevronDown", (
  <>
    <path d="m6 9.5 6 6 6-6" />
  </>
));

/* 10b. ChevronUp / Expand Caret */
export const ChevronUp = createCustomIcon("ChevronUp", (
  <>
    <path d="m18 14.5-6-6-6 6" />
  </>
));

/* 11. ChevronRight / Expand Caret */
export const ChevronRight = createCustomIcon("ChevronRight", (
  <>
    <path d="m9.5 6 6 6-6 6" />
  </>
));

/* 12. Cpu / Silicon AI Processor & Router Engine */
export const Cpu = createCustomIcon("Cpu", (
  <>
    <rect x="5.5" y="5.5" width="13" height="13" rx="2.5" />
    <rect x="9" y="9" width="6" height="6" rx="1" />
    <line x1="9" y1="1.5" x2="9" y2="5.5" />
    <line x1="15" y1="1.5" x2="15" y2="5.5" />
    <line x1="9" y1="18.5" x2="9" y2="22.5" />
    <line x1="15" y1="18.5" x2="15" y2="22.5" />
    <line x1="1.5" y1="9" x2="5.5" y2="9" />
    <line x1="1.5" y1="15" x2="5.5" y2="15" />
    <line x1="18.5" y1="9" x2="22.5" y2="9" />
    <line x1="18.5" y1="15" x2="22.5" y2="15" />
  </>
));

/* 13. Database / Multi-Tier Data Storage */
export const Database = createCustomIcon("Database", (
  <>
    <ellipse cx="12" cy="5.5" rx="8" ry="2.75" />
    <path d="M4 12c0 1.5 3.6 2.75 8 2.75s8-1.25 8-2.75" />
    <path d="M4 5.5v13c0 1.5 3.6 2.75 8 2.75s8-1.25 8-2.75v-13" />
    <circle cx="7.5" cy="12" r="0.75" fill="currentColor" stroke="none" />
    <circle cx="7.5" cy="18.5" r="0.75" fill="currentColor" stroke="none" />
  </>
));

/* 14. Download / Inbound Transfer */
export const Download = createCustomIcon("Download", (
  <>
    <path d="M4 16.5v2.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5" />
    <line x1="12" y1="3.5" x2="12" y2="14.5" />
    <polyline points="7 10 12 15 17 10" />
  </>
));

/* 15. ExternalLink / Outbound Portal */
export const ExternalLink = createCustomIcon("ExternalLink", (
  <>
    <path d="M14 4h6v6" />
    <line x1="10" y1="14" x2="20" y2="4" />
    <path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" />
  </>
));

/* 16. Eye / Visibility Aperture */
export const Eye = createCustomIcon("Eye", (
  <>
    <path d="M2.5 12s3.6-7 9.5-7 9.5 7 9.5 7-3.6 7-9.5 7-9.5-7-9.5-7Z" />
    <circle cx="12" cy="12" r="3.2" />
    <circle cx="13" cy="11" r="0.8" fill="currentColor" stroke="none" />
  </>
));

/* 17. EyeOff / Hidden Password Aperture */
export const EyeOff = createCustomIcon("EyeOff", (
  <>
    <line x1="2.5" y1="2.5" x2="21.5" y2="21.5" />
    <path d="M9.88 4.25A10.5 10.5 0 0 1 12 4c6.2 0 9.5 8 9.5 8a18.2 18.2 0 0 1-4.14 5.38" />
    <path d="M14.12 14.12a3.2 3.2 0 0 1-4.24-4.24" />
    <path d="M6.6 6.6A18.8 18.8 0 0 0 2.5 12s3.6 8 9.5 8a10.4 10.4 0 0 0 5.4-1.5" />
  </>
));

/* 18. FileText / Log & Document Sheet */
export const FileText = createCustomIcon("FileText", (
  <>
    <path d="M14 2.5H6a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.5Z" />
    <polyline points="14 2.5 14 8.5 20 8.5" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="13.5" y2="17" />
  </>
));

/* 19. Globe / Global Network Mesh */
export const Globe = createCustomIcon("Globe", (
  <>
    <circle cx="12" cy="12" r="9.5" />
    <line x1="2.5" y1="12" x2="21.5" y2="12" />
    <ellipse cx="12" cy="12" rx="4.5" ry="9.5" />
  </>
));

/* 20. HelpCircle / Knowledge Guide */
export const HelpCircle = createCustomIcon("HelpCircle", (
  <>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M9.5 9a2.5 2.5 0 0 1 4.75.95c0 1.55-1.75 2.3-1.75 3.3" />
    <circle cx="12.5" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
  </>
));

/* 21. ImagePlus / Media Attachment */
export const ImagePlus = createCustomIcon("ImagePlus", (
  <>
    <rect x="3" y="4" width="13" height="15" rx="2" />
    <path d="m3 14 3.5-3.5a1.8 1.8 0 0 1 2.5 0L14 15.5" />
    <circle cx="7.5" cy="8" r="1.5" />
    <line x1="19" y1="6" x2="19" y2="12" />
    <line x1="16" y1="9" x2="22" y2="9" />
  </>
));

/* 22. Info / System Information */
export const Info = createCustomIcon("Info", (
  <>
    <circle cx="12" cy="12" r="9.5" />
    <line x1="12" y1="11" x2="12" y2="16.5" />
    <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
  </>
));

/* 23. Key / Cryptographic Security Key */
export const Key = createCustomIcon("Key", (
  <>
    <circle cx="7.5" cy="16.5" r="3" />
    <path d="m9.6 14.4 7.9-7.9" />
    <path d="M16 8l1.5-1.5" />
    <path d="M18.5 10.5 20 9" />
    <circle cx="7.5" cy="16.5" r="1" fill="currentColor" stroke="none" />
  </>
));

/* 24. Layers / Multi-Layer Network Architecture */
export const Layers = createCustomIcon("Layers", (
  <>
    <polygon points="12 3 3 7.5 12 12 21 7.5 12 3" />
    <path d="m3 12 9 4.5 9-4.5" />
    <path d="m3 16.5 9 4.5 9-4.5" />
  </>
));

/* 25. Loader2 / Dynamic Network Activity Indicator */
export const Loader2 = createCustomIcon("Loader2", (
  <>
    <path d="M12 2.5a9.5 9.5 0 0 1 9.5 9.5" />
    <path d="M12 21.5a9.5 9.5 0 0 1-9.5-9.5" opacity="0.3" />
  </>
));

/* 26. Lock / Protected Firewall & Encrypted Channel */
export const Lock = createCustomIcon("Lock", (
  <>
    <path d="M7 10V6.5a5 5 0 0 1 10 0V10" />
    <rect x="4" y="10" width="16" height="11.5" rx="2.5" />
    <circle cx="12" cy="14.5" r="1.5" />
    <line x1="12" y1="16" x2="12" y2="18.5" />
  </>
));

/* 27. LogIn / Session Gateway Inbound */
export const LogIn = createCustomIcon("LogIn", (
  <>
    <path d="M14 3.5h4.5a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H14" />
    <line x1="3.5" y1="12" x2="14.5" y2="12" />
    <polyline points="10 7.5 14.5 12 10 16.5" />
  </>
));

/* 28. LogOut / Sign Out Session */
export const LogOut = createCustomIcon("LogOut", (
  <>
    <path d="M10 20.5H5.5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2H10" />
    <line x1="9.5" y1="12" x2="20.5" y2="12" />
    <polyline points="16 7.5 20.5 12 16 16.5" />
  </>
));

/* 29. Menu / Interface Drawer Toggle */
export const Menu = createCustomIcon("Menu", (
  <>
    <line x1="3.5" y1="6.5" x2="20.5" y2="6.5" />
    <line x1="3.5" y1="12" x2="16.5" y2="12" />
    <line x1="3.5" y1="17.5" x2="20.5" y2="17.5" />
  </>
));

/* 30. MessageCircleQuestion / Ask Prompt Card */
export const MessageCircleQuestion = createCustomIcon("MessageCircleQuestion", (
  <>
    <path d="M19.5 12a7.5 7.5 0 0 1-12 6l-4 1 1-3.8A7.5 7.5 0 1 1 19.5 12Z" />
    <path d="M10.5 9.5a1.8 1.8 0 0 1 3.4.6c0 1.1-1.4 1.6-1.4 2.4" />
    <circle cx="12.5" cy="14.8" r="0.6" fill="currentColor" stroke="none" />
  </>
));

/* 31. MessageSquare / Chat Conversation Thread */
export const MessageSquare = createCustomIcon("MessageSquare", (
  <>
    <path d="M20.5 4.5h-17a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4l4 3.5v-3.5h9a2 2 0 0 0 2-2v-10a2 2 0 0 0-2-2Z" />
    <line x1="7" y1="10" x2="17" y2="10" />
  </>
));

/* 32. Moon / Dark Mode Theme */
export const Moon = createCustomIcon("Moon", (
  <>
    <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a7 7 0 0 1-7.54-7.54c-.44-.06-.9-.1-1.36-.1Z" />
  </>
));

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

export const Network = createCustomIcon("Network", (
  <>
    <rect x="9" y="2" width="6" height="6" rx="1.5" />
    <path d="M12 8v5M5 16v-3h14v3" />
    <rect x="2" y="16" width="6" height="6" rx="1.5" />
    <rect x="16" y="16" width="6" height="6" rx="1.5" />
  </>
));

export const Bell = createCustomIcon("Bell", (
  <>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </>
));

export const BarChart3 = createCustomIcon("BarChart3", (
  <>
    <path d="M3 3v18h18" />
    <path d="M18 17V9" />
    <path d="M13 17V5" />
    <path d="M8 17v-3" />
  </>
));

export const Shield = createCustomIcon("Shield", (
  <>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </>
));

export const FileDiff = createCustomIcon("FileDiff", (
  <>
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="9" y1="12" x2="15" y2="12" />
    <line x1="12" y1="9" x2="12" y2="15" />
  </>
));

export const History = createCustomIcon("History", (
  <>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l4 2" />
  </>
));

export const Users = createCustomIcon("Users", (
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </>
));

export const HardDrive = createCustomIcon("HardDrive", (
  <>
    <line x1="22" y1="12" x2="2" y2="12" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    <line x1="6" y1="16" x2="6.01" y2="16" />
    <line x1="10" y1="16" x2="10.01" y2="16" />
  </>
));



