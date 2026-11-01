// Where to go after logging in. Only paths inside this app are accepted, so a crafted link can
// never send a freshly signed-in seller to another website (open redirect).

export const HOME_PATH = '/';
export const LOGIN_PATH = '/login';

/** Paths that make no sense to return to after logging in. */
const AUTH_PATHS = ['/login', '/signup', '/forgot-password', '/auth/'];

export interface ReturnTo {
  pathname: string;
  search?: string;
  hash?: string;
}

/** Router state that RequireAuth leaves for the login page. */
export interface LoginState {
  from?: ReturnTo;
}

export function safeReturnPath(from: unknown): string {
  if (typeof from !== 'object' || from === null) return HOME_PATH;
  const { pathname, search, hash } = from as Partial<Record<keyof ReturnTo, unknown>>;
  if (typeof pathname !== 'string') return HOME_PATH;
  // Internal paths only: one leading slash, no "//host" or "/\host", no scheme, no control characters.
  if (
    !pathname.startsWith('/') ||
    pathname.startsWith('//') ||
    pathname.includes('\\') ||
    [...pathname].some((char) => char.charCodeAt(0) < 0x20)
  ) {
    return HOME_PATH;
  }
  if (AUTH_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
    return HOME_PATH;
  }
  const query = typeof search === 'string' && search.startsWith('?') ? search : '';
  const fragment = typeof hash === 'string' && hash.startsWith('#') ? hash : '';
  return `${pathname}${query}${fragment}`;
}
