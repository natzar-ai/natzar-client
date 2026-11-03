// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import type {SelectHTMLAttributes} from 'react';
/** Native mobile/keyboard behavior with the same field and chevron everywhere. */
export function GuestSingleSelect({children, className = '', compact = false, ...props}: SelectHTMLAttributes<HTMLSelectElement> & {compact?: boolean}) {
  return <span className="guest-single-select-wrap" data-compact={compact || undefined}>
    <select {...props} className={`guest-single-select ${className}`}>{children}</select>
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
  </span>;
}
