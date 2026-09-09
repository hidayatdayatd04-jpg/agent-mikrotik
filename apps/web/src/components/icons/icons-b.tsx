import { createCustomIcon } from "./base";

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
