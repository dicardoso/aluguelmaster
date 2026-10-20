import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import productionConfig from '../firebase-applet-config.json';
import { resolveAppEnv } from './lib/appEnv';

// Each environment talks to its own Firebase project, configured through VITE_FIREBASE_*
// (inlined at build time — the web config is public, not a secret). The committed JSON is
// the production project and is only used as a fallback when APP_ENV is production, so a
// missing variable on develop/local fails loudly instead of silently hitting production.
function loadFirebaseConfig() {
  const env = import.meta.env;
  if (env.VITE_FIREBASE_PROJECT_ID) {
    return {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    };
  }
  if (resolveAppEnv(env.APP_ENV) === 'production') return productionConfig;
  throw new Error(
    'Firebase is not configured for this environment: set the VITE_FIREBASE_* variables (see .env.example).'
  );
}

const app = initializeApp(loadFirebaseConfig());
export const auth = getAuth(app);
// Storage is optional outside production: a free (Spark) Firebase project can run Auth
// alone, and getStorage() throws without a bucket. Callers must handle null.
export const storage = app.options.storageBucket ? getStorage(app) : null;
export const googleProvider = new GoogleAuthProvider();

export const signIn = () => signInWithPopup(auth, googleProvider);
export const logout = () => signOut(auth);
