/* Handcrafted Custom Modern Icons for MikroTik AI Agent */
import React, { forwardRef, type SVGProps } from "react";

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
}

export function createCustomIcon(name: string, content: React.ReactNode) {
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
