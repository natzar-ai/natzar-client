// The customer's own objects the samples assume (an Express or Hono app, a
// user store, the logged-in user). Minimal shapes, for type-checking only.

interface AppUser {
  id: string;
  phone: string;
  email: string;
  first: string;
  last: string;
  dob: string;
  sex: string;
}

/** Cloudflare `wrangler types` generates an INTERFACE like this one. */
interface Env {
  NATZAR_API_KEY: string;
  NATZAR_WEBHOOK_SECRET: string;
}

/** Express (`app.use`) and Hono (`app.all`), as far as the samples use them. */
declare const app: {
  use(path: string, handler: unknown): void;
  all(path: string, handler: (c: {req: {raw: Request}; env: Env}) => Promise<Response> | Response): void;
};
declare const users: {
  get(id: string): Promise<AppUser | null>;
  byAuth0Id(sub: string): Promise<AppUser | null>;
};
declare function currentUser(req: Request): Promise<(AppUser & {sessionId: string}) | null>;
declare function bumpBadge(): void;
/** §3.3's add-clinician flow and logout route. */
declare const user: {id: string; email: string; firstName: string; lastName: string};
declare const req: {sessionID: string};
declare const redis: {set(key: string, value: number, opts: {NX: boolean; EX: number}): Promise<string | null>};
