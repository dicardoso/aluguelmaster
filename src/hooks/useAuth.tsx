import React, { useState, useEffect, createContext, useContext } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '../firebase';
import { UserProfile } from '../types';
import { apiFetch } from '../lib/api';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  isLandlord: boolean;
  isTenant: boolean;
  updateTheme: (theme: 'light' | 'dark' | 'system') => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  isAdmin: false,
  isLandlord: false,
  isTenant: false,
  updateTheme: async () => {},
  refreshProfile: async () => {},
});

// The API returns the Postgres row shape (`id`), while the rest of the app still
// addresses users by `uid` (a holdover from the Firestore days) — bridge the two here
// instead of renaming every `profile.uid` call site in this migration step.
const toUserProfile = (data: any): UserProfile => ({ ...data, uid: data.id });

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const applyTheme = (theme: 'light' | 'dark' | 'system' | undefined) => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'dark') {
      root.classList.add('dark');
    } else if (theme === 'light') {
      root.classList.add('light');
    } else {
      // System
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const data = await apiFetch<any>('/api/me');
          const loadedProfile = toUserProfile(data);
          setProfile(loadedProfile);
          applyTheme(loadedProfile.themePreference);
        } catch (error) {
          console.error('Failed to load profile:', error);
        }
      } else {
        setProfile(null);
        applyTheme('system');
      }
      setLoading(false);
    });

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (!profile?.themePreference || profile.themePreference === 'system') {
        applyTheme('system');
      }
    };
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      unsubscribe();
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [profile?.themePreference]);

  const updateTheme = async (theme: 'light' | 'dark' | 'system') => {
    if (!user || !profile) return;

    try {
      const data = await apiFetch<any>('/api/me', {
        method: 'PATCH',
        body: JSON.stringify({ themePreference: theme }),
      });
      setProfile(toUserProfile(data));
      applyTheme(theme);
    } catch (error) {
      console.error('Failed to update theme:', error);
    }
  };

  const refreshProfile = async () => {
    if (!user) return;
    try {
      const data = await apiFetch<any>('/api/me');
      setProfile(toUserProfile(data));
    } catch (error) {
      console.error('Failed to refresh profile:', error);
    }
  };

  const value = {
    user,
    profile,
    loading,
    isAdmin: profile?.role === 'admin',
    isLandlord: profile?.role === 'landlord',
    isTenant: profile?.role === 'tenant',
    updateTheme,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
