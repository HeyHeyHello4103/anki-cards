import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { firebaseConfig } from '../firebaseConfig';

const useEmulator = import.meta.env.VITE_USE_EMULATOR === '1';

export const configured = useEmulator || Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

function init(): { auth: Auth; db: Firestore } {
  const app = initializeApp(
    useEmulator ? { apiKey: 'demo-key', projectId: 'demo-anki', authDomain: '127.0.0.1' } : firebaseConfig,
  );
  const auth = getAuth(app);
  // 端末に保存しておき、電波がない場所でも学習を続けられるようにする
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    ignoreUndefinedProperties: true,
  });
  if (useEmulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  return { auth, db };
}

const fb = configured ? init() : null;

export const auth = fb?.auth as Auth;
export const db = fb?.db as Firestore;
