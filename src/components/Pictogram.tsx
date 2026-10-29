/**
 * Discipline pictograms, drawn on a 24-unit grid with orthogonal and 45° geometry
 * (after the Munich '72 programme system). Filled shapes, one visual weight.
 */
import type { DomainId } from '../content/types';

const shapes: Record<DomainId, React.ReactNode> = {
  // a 3×3 result grid with a filled header row
  sql: (
    <>
      <rect x="3" y="4" width="18" height="4" />
      <rect x="3" y="10" width="5" height="4" />
      <rect x="9.5" y="10" width="5" height="4" />
      <rect x="16" y="10" width="5" height="4" />
      <rect x="3" y="16" width="5" height="4" />
      <rect x="9.5" y="16" width="5" height="4" />
      <rect x="16" y="16" width="5" height="4" />
    </>
  ),
  // star schema: fact square, four dimension discs on the diagonals
  modeling: (
    <>
      <rect x="8.5" y="8.5" width="7" height="7" />
      <circle cx="4.5" cy="4.5" r="2.5" />
      <circle cx="19.5" cy="4.5" r="2.5" />
      <circle cx="4.5" cy="19.5" r="2.5" />
      <circle cx="19.5" cy="19.5" r="2.5" />
      <path d="M6 5 9.5 8.5 8.5 9.5 5 6zM18 5l1 1-3.5 3.5-1-1zM6 19l-1-1 3.5-3.5 1 1zM18 19l-3.5-3.5 1-1L19 18z" />
    </>
  ),
  // a DAG: one source feeding two models
  dbt: (
    <>
      <rect x="2.5" y="9.5" width="5" height="5" />
      <rect x="16.5" y="3.5" width="5" height="5" />
      <rect x="16.5" y="15.5" width="5" height="5" />
      <path d="M7.5 11.2 15.2 5.2l1.3 1.6-7.7 6zM8.8 11 16.5 17l-1.3 1.6L7.5 12.8z" />
    </>
  ),
  // a test passing: square with a check cut through it
  quality: <path fillRule="evenodd" d="M3 3h18v18H3zm4.4 9.3 3.2 3.2 6.5-6.5-1.6-1.6-4.9 4.9-1.6-1.6z" />,
  // a measure: three bars on a baseline
  semantic: (
    <>
      <rect x="3" y="12" width="4.5" height="8" />
      <rect x="9.75" y="7" width="4.5" height="13" />
      <rect x="16.5" y="3" width="4.5" height="17" />
      <rect x="2" y="20.5" width="20" height="1.5" />
    </>
  ),
  // stacked storage slabs
  warehouse: (
    <>
      <rect x="3" y="3" width="18" height="5" rx="2.5" />
      <rect x="3" y="9.5" width="18" height="5" rx="2.5" />
      <rect x="3" y="16" width="18" height="5" rx="2.5" />
    </>
  ),
  // a branch merging back
  workflow: (
    <>
      <circle cx="6" cy="4.5" r="2.5" />
      <circle cx="6" cy="19.5" r="2.5" />
      <circle cx="18" cy="9" r="2.5" />
      <rect x="5" y="6" width="2" height="12" />
      <path d="M17 11v1.5c0 2.2-1.8 4-4 4H7v-2h6c1.1 0 2-.9 2-2V11z" />
    </>
  ),
  // scheduled runs on a timeline
  orchestration: (
    <>
      <rect x="2" y="11" width="20" height="2" />
      <rect x="3" y="5" width="5" height="5" />
      <rect x="9.5" y="14" width="5" height="5" />
      <rect x="16" y="5" width="5" height="5" />
    </>
  ),
  // a catalogue page with entries
  governance: (
    <>
      <path fillRule="evenodd" d="M5 2h10l4 4v16H5zm3 7v1.6h8V9zm0 4v1.6h8V13zm0 4v1.6h5V17z" />
    </>
  ),
  // two figures in conversation
  business: (
    <>
      <circle cx="7" cy="5" r="2.6" />
      <circle cx="17" cy="5" r="2.6" />
      <path d="M3.5 9.5h7l1 6h-2l-.5 6.5h-4L4.5 15.5h-2z" />
      <path d="M13.5 9.5h7l1 6h-2l-.5 6.5h-4l-.5-6.5h-2z" />
    </>
  ),
};

export function Pictogram({ domain, size = 20, className, title }: { domain: DomainId; size?: number; className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      {shapes[domain]}
    </svg>
  );
}

/** The product mark: an L-plate square on the programme grid. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} aria-hidden>
      <rect width="28" height="28" rx="3" fill="var(--surface)" />
      <rect x="2" y="2" width="24" height="24" rx="2" fill="none" stroke="var(--ink)" strokeWidth="1.5" />
      <path d="M8 6.5h4v11h8v4H8z" fill="var(--d-dbt)" />
    </svg>
  );
}
