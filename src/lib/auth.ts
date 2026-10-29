import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
import { auth, db } from './firebase';
import type { MemberDoc } from './types';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'unverified'; user: User }
  | { status: 'notMember'; user: User }
  | { status: 'error'; user: User; message: string }
  | { status: 'ready'; user: User; member: MemberDoc };

export const emailOf = (user: User) => (user.email ?? '').toLowerCase();

async function evaluate(user: User | null): Promise<AuthState> {
  if (!user) return { status: 'signedOut' };
  if (!user.emailVerified) return { status: 'unverified', user };
  const ref = doc(db, 'members', emailOf(user));
  try {
    const snap = await getDoc(ref);
    return snap.exists() ? { status: 'ready', user, member: snap.data() as MemberDoc } : { status: 'notMember', user };
  } catch (e) {
    // メール確認直後はトークンが古いことがあるので、更新して1回だけやり直す
    if ((e as { code?: string }).code === 'permission-denied') {
      try {
        await user.getIdToken(true);
        const snap = await getDoc(ref);
        return snap.exists() ? { status: 'ready', user, member: snap.data() as MemberDoc } : { status: 'notMember', user };
      } catch {
        return { status: 'notMember', user };
      }
    }
    return { status: 'error', user, message: (e as Error).message };
  }
}

export function useAuthState(): [AuthState, () => Promise<void>] {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  useEffect(() => onAuthStateChanged(auth, (user) => void evaluate(user).then(setState)), []);
  const recheck = useCallback(async () => {
    const user = auth.currentUser;
    if (user) {
      await user.reload();
      await user.getIdToken(true);
    }
    setState(await evaluate(auth.currentUser));
  }, []);
  return [state, recheck];
}
