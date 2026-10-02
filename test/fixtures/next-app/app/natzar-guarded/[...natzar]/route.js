// The SAME middleware under a path the middleware matcher does NOT exclude:
// the documented misplacement (the guard redirects a signed-out user).
import {make} from '../../../lib/natzar.js';

export const {GET, POST} = make();
