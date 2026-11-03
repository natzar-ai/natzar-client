import {createRoot, type Root} from 'react-dom/client';
import {NatzarGuest} from './react';

/** Define the guest-only tag without changing the authenticated v2 loader. */
export function registerGuestElement(registry = globalThis.customElements): void {
  if (!registry || registry.get('natzar-guest')) return;
  class NatzarGuestElement extends HTMLElement {
    static get observedAttributes() {return ['clinic-id', 'graphql-url', 'api-key', 'locale', 'clinic-name'];}
    private root: Root | null = null;
    connectedCallback() {
      if (!this.root) this.root = createRoot(this.shadowRoot ?? this.attachShadow({mode: 'open'}));
      this.render();
    }
    disconnectedCallback() {this.root?.unmount(); this.root = null;}
    attributeChangedCallback() {if (this.isConnected) this.render();}
    private render() {
      const clinicId = this.getAttribute('clinic-id') ?? '';
      const graphqlUrl = this.getAttribute('graphql-url') ?? '';
      const apiKey = this.getAttribute('api-key') ?? '';
      if (!clinicId || !graphqlUrl || !apiKey) return;
      this.root?.render(<NatzarGuest clinicId={clinicId} graphqlUrl={graphqlUrl} apiKey={apiKey}
        locale={this.getAttribute('locale') ?? undefined} clinicName={this.getAttribute('clinic-name') ?? undefined}
        onReady={care => this.dispatchEvent(new CustomEvent('natzar:guest:ready', {detail: {modality: care.modality, id: care.id}, bubbles: true, composed: true}))}/>);
    }
  }
  registry.define('natzar-guest', NatzarGuestElement);
}
