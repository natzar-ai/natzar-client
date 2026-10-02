// Minimal stubs of the third-party modules the samples import. Only what the
// samples call; the real SDKs are not dependencies of this package.

declare module '@/auth' {
  /** Auth.js / NextAuth v5 `auth()` in a Next.js app. */
  export function auth(): Promise<{
    user?: {id: string; role: string; mfa: boolean; phone: string; email: string; givenName: string; familyName: string; birthdate: string; sex: string};
    expires: string;
  } | null>;
}

declare module 'firebase-admin/auth' {
  export function getAuth(): {verifyIdToken(token: string): Promise<{uid: string; auth_time: number}>};
}

declare module 'firebase/auth' {
  export function getAuth(): {currentUser: {getIdToken(): Promise<string>} | null};
}

declare module 'jose' {
  export function createRemoteJWKSet(url: URL): unknown;
  export function jwtVerify(token: string, key: unknown, opts: {issuer: string; audience: string}): Promise<{payload: {sub?: string; exp?: number; iat?: number}}>;
}

declare module '@auth0/auth0-spa-js' {
  export function createAuth0Client(opts: {domain: string; clientId: string; authorizationParams?: {audience?: string}}): Promise<{
    getTokenSilently(): Promise<string>;
  }>;
}
