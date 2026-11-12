// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {forwardRef, type ComponentPropsWithoutRef} from 'react';

export function AgentHeader({children, style, ...props}: ComponentPropsWithoutRef<'header'>) {
  return <header {...props} data-nz-agent-header="" style={{
    flexShrink: 0, borderBottom: '1px solid var(--nz-border, #e2ddd3)', padding: '10px 16px',
    textAlign: 'center', fontSize: 13, color: 'var(--nz-muted, #5b6470)', background: 'var(--nz-card, #fff)',
    ...style,
  }}>{children}</header>;
}

/** Shared empty conversation surface for registered patients and guests. */
export function AgentWelcome({message}: {message: string}) {
  return <p data-nz-agent-welcome="" style={{margin: '32px 0 0', textAlign: 'center', fontSize: 13.5, color: 'var(--nz-muted, #5b6470)'}}>{message}</p>;
}

const agentThreadBackground = 'var(--nz-thread, color-mix(in srgb, var(--nz-accent, #111111) 6%, var(--nz-bg, #f6f5f2)))';

export function AgentTyping({className, label}: {className?: string; label?: string}) {
  return <div className={className} data-nz-typing="" role="status" aria-label={label} style={{
    display: 'flex', alignItems: 'center', gap: 6, width: 'fit-content', marginBottom: 8, padding: '10px 12px',
    background: 'var(--nz-incoming, #fff)', borderRadius: 'var(--nz-radius, 18px)',
  }}>
    {[0, 1, 2].map(index => <span key={index} style={{
      width: 6, height: 6, borderRadius: '50%', background: 'var(--nz-muted, #5b6470)', animationDelay: `${index * 120}ms`,
    }}/>)}
  </div>;
}

/** One transcript layout, background and emergency notice for every agent chat. */
export const AgentThread = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'> & {emergencyMessage: string}>(
  function AgentThread({children, emergencyMessage, style, ...props}, ref) {
    return <div {...props} ref={ref} data-nz-agent-thread="" style={{
      flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', scrollbarWidth: 'thin',
      padding: 16, background: agentThreadBackground, ...style,
    }}>
      <style>{`
        [data-nz-typing] > span { animation: nz-chat-typing 1.2s ease-in-out infinite; }
        @keyframes nz-chat-typing { 0%,60%,100% { opacity: .4; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
        @media (prefers-reduced-motion: reduce) { [data-nz-typing] > span { animation: none; } }
      `}</style>
      <div style={{display: 'flex', flexDirection: 'column', maxWidth: 560, margin: '0 auto'}}>
        {children}
        <p data-nz-emergency-notice="" style={{
          fontSize: 11, lineHeight: 1.5, color: 'var(--nz-muted, #5b6470)', margin: '12px 0 0', textAlign: 'center',
        }}>{emergencyMessage}</p>
      </div>
    </div>;
  },
);
