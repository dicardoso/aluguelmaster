export type User = any;
export const onAuthStateChanged = (auth: any, cb: (u: any) => void) => {
  const g = (globalThis as any).__e2eAuth;
  g.listeners.add(cb);
  setTimeout(() => cb(auth.currentUser), 0);
  return () => g.listeners.delete(cb);
};
export class GoogleAuthProvider {}
export const getAuth = () => ({});
export const signInWithPopup = async () => {};
export const signOut = async () => {};
