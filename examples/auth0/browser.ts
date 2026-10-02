// Auth0 — the page. Two lines (the client you already have, and the hook), plus the tag:
//   <script src="/natzar/embed.js" async></script>
//   <natzar-agent></natzar-agent>
import {createAuth0Client} from '@auth0/auth0-spa-js';

const auth0 = await createAuth0Client({domain: 'acme.eu.auth0.com', clientId: 'your-client-id', authorizationParams: {audience: 'https://api.acme.com'}});
window.natzarConfig = {auth: () => auth0.getTokenSilently().catch(() => undefined)};   // signed out: no bearer → signed-out state
