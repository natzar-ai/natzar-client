// app/natzar/[...natzar]/route.js — the documented convention (plan §3.4):
// excluded from the middleware matcher.
import {make} from '../../../lib/natzar.js';

export const {GET, POST} = make();
