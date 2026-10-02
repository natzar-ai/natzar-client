// Plan §3.6, verbatim (front).
import {getAuth} from 'firebase/auth';
window.natzarConfig = {auth: () => getAuth().currentUser?.getIdToken()};   // the broker sends it as a Bearer header
