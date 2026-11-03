// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {forwardRef, type ComponentPropsWithoutRef} from 'react';

/** Shared empty conversation surface for registered patients and guests. */
export function AgentWelcome({message}: {message: string}) {
  return <p data-nz-agent-welcome="" style={{margin: '32px 0 0', textAlign: 'center', fontSize: 13.5, color: 'var(--nz-muted, #5b6470)'}}>{message}</p>;
}

const agentThreadBackground = 'var(--nz-thread, color-mix(in srgb, var(--nz-accent, #111111) 6%, var(--nz-bg, #f6f5f2)))';

/** One transcript layout, background and emergency notice for every agent chat. */
export const AgentThread = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'> & {emergencyMessage: string}>(
  function AgentThread({children, emergencyMessage, style, ...props}, ref) {
    return <div {...props} ref={ref} data-nz-agent-thread="" style={{
      flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', scrollbarWidth: 'thin',
      padding: 16, background: agentThreadBackground, ...style,
    }}>
      <div style={{display: 'flex', flexDirection: 'column', maxWidth: 560, margin: '0 auto'}}>
        {children}
        <p data-nz-emergency-notice="" style={{
          fontSize: 11, lineHeight: 1.5, color: 'var(--nz-muted, #5b6470)', margin: '12px 0 0', textAlign: 'center',
        }}>{emergencyMessage}</p>
      </div>
    </div>;
  },
);
