import { create } from 'zustand';

/** Empty when the API is served from the same origin (Render single service, Vite proxy). */
export const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/+$/, '');
const CROSS_ORIGIN = API_BASE !== '';
const TOKEN_KEY = 'bgm-editor:token';

/**
 * 'checking' until /api/session answers; 'locked' when the entry password is required.
 * `entered` remembers that the editor was shown once, so a later 401 overlays the gate
 * instead of unmounting the editor.
 */
export const useAuth = create<{ status: 'checking' | 'open' | 'locked'; entered: boolean }>(() => ({
  status: 'checking',
  entered: false,
}));

// Cross-site front end: Safari and browsers blocking third-party cookies drop the session
// cookie, so the server also returns the token and we send it as a Bearer header.
function getToken(): string | null {
  if (!CROSS_ORIGIN) return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: cookie only */
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: CROSS_ORIGIN ? 'include' : 'same-origin' });
  if (res.status === 401) {
    setToken(null);
    if (useAuth.getState().status === 'open') useAuth.setState({ status: 'locked' });
  }
  return res;
}

export async function checkSession() {
  try {
    const res = await apiFetch('/api/session', { cache: 'no-store' });
    const j = (await res.json()) as { required?: boolean; ok?: boolean };
    const open = !j.required || !!j.ok;
    useAuth.setState({ status: open ? 'open' : 'locked', entered: open });
  } catch {
    // No API reachable (front end alone, server down): keep the editor usable for local files.
    useAuth.setState({ status: 'open', entered: true });
  }
}

/** Returns an error message, or null on success. */
export async function login(password: string): Promise<string | null> {
  let res: Response;
  try {
    res = await apiFetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  } catch {
    return '서버에 연결할 수 없습니다.';
  }
  const j = (await res.json().catch(() => null)) as { ok?: boolean; token?: string; error?: string } | null;
  if (!res.ok || !j?.ok) return j?.error ?? `입장하지 못했습니다 (HTTP ${res.status})`;
  if (j.token) setToken(j.token);
  useAuth.setState({ status: 'open', entered: true });
  return null;
}
