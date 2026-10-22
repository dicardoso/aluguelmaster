// Stand-in for src/firebase.ts in the E2E vite server: identity comes from localStorage.e2e_token
const listeners = new Set<(u: any) => void>();
const read = () => { try { return localStorage.getItem('e2e_token'); } catch { return null; } };
const userFor = (token: string | null) => {
  if (!token) return null;
  const claims = JSON.parse(atob(token.slice(5)));
  return { uid: claims.uid, email: claims.email, displayName: claims.name ?? null, getIdToken: async () => token };
};
export const auth: any = { get currentUser() { return userFor(read()); } };
(globalThis as any).__e2eAuth = { auth, listeners };
export const storage: any = {};
export const googleProvider = {};
const notify = () => listeners.forEach((l) => l(auth.currentUser));
export const signIn = async () => {
  const next = localStorage.getItem('e2e_login_token');
  if (!next) throw new Error('no e2e_login_token');
  localStorage.setItem('e2e_token', next);
  notify();
};
export const logout = async () => { localStorage.removeItem('e2e_token'); notify(); };
