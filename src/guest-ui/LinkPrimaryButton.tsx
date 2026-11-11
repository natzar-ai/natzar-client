// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import type {ReactNode} from 'react';

export function LinkActionRow({children, className}: {children: ReactNode; className?: string}) {
  return <div className={className} style={{display: 'flex', gap: 8, marginTop: 12}}>{children}</div>;
}

export function LinkPrimaryButton({label, busy, disabled, onClick}: {
  label: string;
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return <button type="button" onClick={onClick} disabled={busy || disabled} aria-disabled={disabled || undefined}
    style={{
      flex: 1, border: 0, borderRadius: 9999, padding: '8px 16px', fontFamily: 'inherit',
      fontSize: 14, fontWeight: 600, lineHeight: 1.45, textAlign: 'center',
      background: disabled ? 'var(--nz-chip, #eae7e0)' : 'var(--nz-accent, #111111)',
      color: disabled ? 'var(--nz-muted, #5b6470)' : 'var(--nz-accent-fg, #fff)',
      opacity: busy || disabled ? 0.6 : 1, cursor: busy || disabled ? 'default' : 'pointer',
    }}>
    {busy ? '…' : label}
  </button>;
}
