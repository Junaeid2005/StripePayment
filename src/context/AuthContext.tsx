import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../firebase';
import { PRIMARY_ADMIN_EMAIL } from '../shared/catalogData';

interface AuthContextValue {
  user: User | null;
  authReady: boolean;
  isAdmin: boolean;
  isBootstrapAdmin: boolean;
  signingIn: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<User | null>;
  signOutUser: () => Promise<void>;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function sanitizeString(value: string, maxLen: number, fallback: string): string {
  const trimmed = value.trim().slice(0, maxLen);
  return trimmed.length > 0 ? trimmed : fallback;
}

async function ensureUserProfileDocument(user: User): Promise<void> {
  if (!user.emailVerified || !user.email) return;

  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  const safeName = sanitizeString(
    user.displayName || user.email.split('@')[0] || 'Guest',
    100,
    'Guest'
  );
  const safePhoto = (user.photoURL || '').trim().slice(0, 500);
  const safeEmail = user.email.trim().slice(0, 160);

  let exists = false;
  try {
    const snap = await getDoc(userRef);
    exists = snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  if (!exists) {
    try {
      await setDoc(userRef, {
        uid: user.uid,
        displayName: safeName,
        email: safeEmail,
        photoURL: safePhoto,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, userPath);
    }
  } else {
    try {
      await updateDoc(userRef, {
        displayName: safeName,
        photoURL: safePhoto,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, userPath);
    }
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isBootstrapAdmin, setIsBootstrapAdmin] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (!currentUser) {
        setIsAdmin(false);
        setIsBootstrapAdmin(false);
        setAuthReady(true);
        return;
      }

      try {
        await ensureUserProfileDocument(currentUser);
      } catch (err) {
        console.error('Failed to sync user profile:', err);
      }

      const bootstrap =
        Boolean(currentUser.emailVerified) &&
        currentUser.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase();

      setIsBootstrapAdmin(bootstrap);

      if (bootstrap) {
        setIsAdmin(true);
        setAuthReady(true);
        return;
      }

      if (currentUser.emailVerified) {
        try {
          const adminSnap = await getDoc(doc(db, 'admins', currentUser.uid));
          setIsAdmin(adminSnap.exists());
        } catch {
          setIsAdmin(false);
        }
      } else {
        setIsAdmin(false);
      }

      setAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async (): Promise<User | null> => {
    setSigningIn(true);
    setAuthError(null);
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      await ensureUserProfileDocument(credential.user);
      return credential.user;
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message.includes('auth/popup-closed-by-user')
            ? 'Google Sign-In popup was closed before completing login.'
            : error.message
          : 'Unable to sign in with Google.';
      setAuthError(msg);
      return null;
    } finally {
      setSigningIn(false);
    }
  };

  const signOutUser = async (): Promise<void> => {
    setAuthError(null);
    await signOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        isAdmin,
        isBootstrapAdmin,
        signingIn,
        authError,
        signInWithGoogle,
        signOutUser,
        clearAuthError: () => setAuthError(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
