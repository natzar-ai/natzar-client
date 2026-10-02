// A global auth guard, as apps have one: signed-out requests go to /login.
// The matcher EXCLUDES /natzar/ (the documented +1 line, plan §3.1) but not
// /natzar-guarded/.
import {NextResponse} from 'next/server';

export function middleware(request) {
  if (request.cookies.get('sid')?.value === 'signed-in') return NextResponse.next();
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  matcher: ['/((?!_next/|natzar/|login|favicon.ico).*)'],
};
