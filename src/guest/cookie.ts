/** The host cookie contains only a scoped opaque conversation credential. */
export interface GuestCookieStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  setExpiry?(expiresAt: string): void;
}
export function createGuestCookieStorage(doc: Document, prefix = 'natzar_guest_'): GuestCookieStorage {
  let expires = Date.now() + 7 * 86400000;
  const name = (key: string) => prefix + encodeURIComponent(key);
  const flags = () => '; Path=/; SameSite=Lax' + (doc.location.protocol === 'https:' ? '; Secure' : '');
  return {
    getItem(key) {
      const start = name(key) + '=';
      const entry = doc.cookie.split(';').map(part => part.trim()).find(part => part.startsWith(start));
      if (!entry) return null;
      try {return decodeURIComponent(entry.slice(start.length));} catch {return null;}
    },
    setItem(key, value) {doc.cookie = name(key) + '=' + encodeURIComponent(value) + '; Max-Age=' + Math.max(0, Math.floor((expires - Date.now()) / 1000)) + flags();},
    removeItem(key) {doc.cookie = name(key) + '=; Max-Age=0' + flags();},
    setExpiry(value) {const timestamp = Date.parse(value); if (Number.isFinite(timestamp)) expires = timestamp;},
  };
}
