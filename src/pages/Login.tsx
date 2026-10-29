import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { useState, type FormEvent } from 'react';
import { auth } from '../lib/firebase';

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'メールアドレスかパスワードが違います',
  'auth/wrong-password': 'メールアドレスかパスワードが違います',
  'auth/user-not-found': 'メールアドレスかパスワードが違います',
  'auth/invalid-email': 'メールアドレスの形式が正しくありません',
  'auth/email-already-in-use': 'このメールアドレスは登録済みです。「ログイン」から入ってください',
  'auth/weak-password': 'パスワードは8文字以上にしてください',
  'auth/missing-password': 'パスワードを入力してください',
  'auth/too-many-requests': '試行回数が多すぎます。しばらく待ってからもう一度お試しください',
  'auth/network-request-failed': 'インターネットに接続できません',
  'auth/popup-blocked': 'ポップアップがブロックされました。ブラウザの設定でこのサイトのポップアップを許可してください',
  'auth/unauthorized-domain':
    'このサイトのドメインがFirebaseで許可されていません（管理者の方へ：Authentication →「設定」→「承認済みドメイン」に追加してください）',
  'auth/operation-not-allowed': 'このログイン方法が有効になっていません（管理者の方へ：Authentication →「ログイン方法」で有効にしてください）',
};

export function authMessage(e: unknown): string | null {
  const code = (e as { code?: string }).code ?? '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
  return MESSAGES[code] ?? `ログインできませんでした（${code || (e as Error).message}）`;
}

const continueUrl = () => location.href.split('#')[0];

export function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setError(authMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const google = () => run(() => signInWithPopup(auth, new GoogleAuthProvider()));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'up' && password.length < 8) {
      setError('パスワードは8文字以上にしてください');
      return;
    }
    run(async () => {
      if (mode === 'in') {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await sendEmailVerification(cred.user, { url: continueUrl() });
      }
    });
  };

  const reset = () => {
    if (!email.trim()) {
      setError('パスワードを再設定するメールアドレスを入力してください');
      return;
    }
    run(async () => {
      await sendPasswordResetEmail(auth, email.trim(), { url: continueUrl() });
      setInfo('パスワード再設定のメールを送りました。届かない場合は迷惑メールフォルダも確認してください');
    });
  };

  return (
    <div className="auth-box stack">
      <div>
        <h1>暗記カード</h1>
        <p className="muted small" style={{ margin: 0 }}>
          ログインすると、どの端末からでも続きから学習できます
        </p>
      </div>
      <button className="btn block big" onClick={google} disabled={busy}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        Googleでログイン
      </button>
      <div className="or">またはメールアドレスで</div>
      <div className="segmented" role="group" aria-label="ログインか新規登録か">
        <button aria-pressed={mode === 'in'} onClick={() => setMode('in')} type="button">
          ログイン
        </button>
        <button aria-pressed={mode === 'up'} onClick={() => setMode('up')} type="button">
          はじめて使う
        </button>
      </div>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          メールアドレス
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          パスワード{mode === 'up' && '（8文字以上）'}
          <input
            type="password"
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="btn primary block big" type="submit" disabled={busy}>
          {mode === 'in' ? 'ログイン' : '登録して確認メールを受け取る'}
        </button>
      </form>
      {mode === 'in' && (
        <div className="center small">
          <button className="link-btn" onClick={reset} type="button">
            パスワードを忘れた場合
          </button>
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
      {info && <div className="notice ok">{info}</div>}
    </div>
  );
}

export function VerifyEmail({ user, onRecheck }: { user: User; onRecheck: () => Promise<void> }) {
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    await onRecheck();
    setBusy(false);
    setMsg({ kind: 'warn', text: 'まだ確認が済んでいないようです。メール内のリンクを開いてから、もう一度押してください' });
  };
  const resend = async () => {
    try {
      await sendEmailVerification(user, { url: continueUrl() });
      setMsg({ kind: 'ok', text: '確認メールを再送しました' });
    } catch (e) {
      setMsg({ kind: 'error', text: authMessage(e) ?? '' });
    }
  };
  return (
    <div className="auth-box stack">
      <h1>メールアドレスの確認</h1>
      <p style={{ margin: 0 }}>
        <b>{user.email}</b> に確認メールを送りました。メール内のリンクを開いてから、下のボタンを押してください。
      </p>
      <p className="muted small" style={{ margin: 0 }}>
        届かない場合は迷惑メールフォルダも確認してください。
      </p>
      <button className="btn primary block big" onClick={check} disabled={busy}>
        確認しました
      </button>
      <div className="row">
        <button className="btn small" onClick={resend}>
          確認メールを再送
        </button>
        <span className="spacer" />
        <button className="btn small" onClick={() => signOut(auth)}>
          ログアウト
        </button>
      </div>
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
    </div>
  );
}

export function NotMember({ user, onRecheck }: { user: User; onRecheck: () => Promise<void> }) {
  return (
    <div className="auth-box stack">
      <h1>利用登録が必要です</h1>
      <p style={{ margin: 0 }}>
        <b>{user.email}</b> はまだ利用者として登録されていません。管理者にこのメールアドレスを伝えて、登録してもらってください。
      </p>
      <div className="row">
        <button className="btn primary" onClick={onRecheck}>
          登録されたので再確認
        </button>
        <span className="spacer" />
        <button className="btn" onClick={() => signOut(auth)}>
          別のアカウントでログイン
        </button>
      </div>
    </div>
  );
}
