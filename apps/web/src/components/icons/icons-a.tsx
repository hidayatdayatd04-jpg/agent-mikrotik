import { createCustomIcon } from "./base";

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
