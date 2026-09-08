import type { MapExportFormat } from "./network-map-export";

export function ExportFormatIcon({ format }: { format: MapExportFormat }) {
  return <span className={`map-format-icon map-format-${format}`}>
    <svg viewBox="0 0 28 32" fill="none" aria-hidden="true">
      <path d="M6 1.5h10l7 7V28a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 3 28V4A2.5 2.5 0 0 1 6 1.5Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16 2v7h7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      {format === "png" ? <><rect x="7" y="12" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" /><circle cx="15.5" cy="15" r="1" fill="currentColor" /><path d="m7 20 4-4 4 4 2-2 2 2" stroke="currentColor" strokeWidth="1.4" /></>
        : format === "pdf" ? <path d="M8 22c4-4 6-12 4-11-2 1 2 10 7 9 3-1-8-3-11 1-2 3 1 3 2 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        : <><path d="m13 12-5 6 5 6 5-6-5-6Z" stroke="currentColor" strokeWidth="1.4" /><path d="M13 12v12m-5-6h10" stroke="currentColor" strokeWidth="1" /><circle cx="13" cy="18" r="2" fill="currentColor" /></>}
    </svg>
  </span>;
}
