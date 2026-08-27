import React, { useState, useEffect, createContext, useContext } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db, doc, getDoc, setDoc, collection, query, where, getDocs, deleteDoc, handleFirestoreError, OperationType } from '../firebase';
import { UserProfile, UserRole } from '../types';
import { sendWelcomeEmail } from '../lib/email';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  isLandlord: boolean;
  isTenant: boolean;
  updateTheme: (theme: 'light' | 'dark' | 'system') => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  isAdmin: false,
  isLandlord: false,
  isTenant: false,
  updateTheme: async () => {},
});

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
        const docRef = doc(db, 'users', firebaseUser.uid);
        try {
          const docSnap = await getDoc(docRef);
          
          if (docSnap.exists()) {
            const data = docSnap.data() as UserProfile;
            setProfile(data);
            applyTheme(data.themePreference);
          } else {
            // Check for pre-registration by email
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('email', '==', firebaseUser.email));
            const querySnap = await getDocs(q);
            
            if (!querySnap.empty) {
              // Found a pre-registration! Update it with the real UID
              const preRegDoc = querySnap.docs[0];
              const preRegData = preRegDoc.data() as UserProfile;
              
              const newProfile: UserProfile = {
                ...preRegData,
                uid: firebaseUser.uid,
                displayName: firebaseUser.displayName || preRegData.displayName,
              };
              
              await setDoc(docRef, newProfile);
              // Delete the temporary invite doc if it had a different ID
              if (preRegDoc.id !== firebaseUser.uid) {
                await deleteDoc(doc(db, 'users', preRegDoc.id));
              }
              setProfile(newProfile);
            } else {
              // Create default profile for new users
              const newProfile: UserProfile = {
                uid: firebaseUser.uid,
                email: firebaseUser.email || '',
                displayName: firebaseUser.displayName || '',
                role: 'tenant', // Default role
                themePreference: 'system',
                createdAt: new Date().toISOString(),
              };
              await setDoc(docRef, newProfile);
              setProfile(newProfile);
              applyTheme('system');
              
              // Send welcome email for new users
              try {
                if (firebaseUser.email) {
                  await sendWelcomeEmail(firebaseUser.email, firebaseUser.displayName || '');
                }
              } catch (emailError) {
                console.error('Failed to send welcome email:', emailError);
                // Don't block the login process if email fails
              }
            }
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`);
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
      const docRef = doc(db, 'users', user.uid);
      await setDoc(docRef, { themePreference: theme }, { merge: true });
      setProfile({ ...profile, themePreference: theme });
      applyTheme(theme);
    } catch (error) {
      console.error('Failed to update theme:', error);
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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
