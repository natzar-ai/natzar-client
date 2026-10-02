// Firebase Auth — the page. One line, plus the tag:
//   <script src="/natzar/embed.js" async></script>
//   <natzar-async></natzar-async>
// For a headless UI instead: connectPatient({endpoint: '/natzar', auth: () => ...}).
import {getAuth} from 'firebase/auth';
import {connectPatient} from '@natzar/client/patient';

window.natzarConfig = {auth: () => getAuth().currentUser?.getIdToken()};   // the broker sends it as a Bearer header

export const headless = () => connectPatient({endpoint: '/natzar', auth: () => getAuth().currentUser?.getIdToken()});
