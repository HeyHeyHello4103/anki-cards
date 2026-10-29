import { useAuthState, emailOf } from './lib/auth';
import { configured } from './lib/firebase';
import { useRoute } from './lib/router';
import type { Scope } from './lib/session';
import { DataProvider, useData } from './lib/store';
import { Admin } from './pages/Admin';
import { Home } from './pages/Home';
import { Login, NotMember, VerifyEmail } from './pages/Login';
import { Settings } from './pages/Settings';
import { Stats } from './pages/Stats';
import { Study } from './pages/Study';

function scopeFrom(route: string[]): Scope {
  if (route[1] === 's' && route[2]) return { kind: 'subject', subject: route[2] };
  if (route[1] === 'u' && route[2] && route[3]) return { kind: 'units', subject: route[2], units: route[3].split(',') };
  if (route[1] === 'weak') return { kind: 'weak' };
  return { kind: 'all' };
}

function Shell() {
  const d = useData();
  const route = useRoute();
  const page = route[0] ?? '';

  if (d.loadError) {
    return (
      <div className="app">
        <div className="auth-box notice error">データを読み込めませんでした: {d.loadError}</div>
      </div>
    );
  }
  if (!d.ready) return <div className="spinner" aria-label="読み込み中" />;

  if (page === 'study') {
    return (
      <div className="app">
        <div style={{ height: 'calc(12px + env(safe-area-inset-top))' }} />
        {/* key を変えて、範囲が変わったら学習を最初から組み立て直す */}
        <Study key={route.join('/')} scope={scopeFrom(route)} />
      </div>
    );
  }

  const links: [string, string, string][] = [
    ['', 'ホーム', '#/'],
    ['stats', '統計', '#/stats'],
    ['settings', '設定', '#/settings'],
  ];
  if (d.isAdmin) links.push(['admin', '管理', '#/admin']);

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          暗記カード
        </a>
        <nav className="nav">
          {links.map(([key, label, href]) => (
            <a key={key} href={href} aria-current={page === key ? 'page' : undefined}>
              {label}
            </a>
          ))}
        </nav>
      </header>
      <main>
        {page === 'stats' ? (
          <Stats />
        ) : page === 'settings' ? (
          <Settings />
        ) : page === 'admin' ? (
          <Admin tab={route[1] ?? 'cards'} />
        ) : (
          <Home />
        )}
      </main>
    </div>
  );
}

function SetupNeeded() {
  return (
    <div className="app">
      <div className="auth-box panel stack">
        <h1>準備中です</h1>
        <p style={{ margin: 0 }}>
          Firebase の設定がまだ入っていません。<code>src/firebaseConfig.ts</code> に Firebase コンソールの値を入れてください。
        </p>
      </div>
    </div>
  );
}

export function App() {
  if (!configured) return <SetupNeeded />;
  return <AuthGate />;
}

function AuthGate() {
  const [state, recheck] = useAuthState();
  switch (state.status) {
    case 'loading':
      return <div className="spinner" aria-label="読み込み中" />;
    case 'signedOut':
      return (
        <div className="app">
          <Login />
        </div>
      );
    case 'unverified':
      return (
        <div className="app">
          <VerifyEmail user={state.user} onRecheck={recheck} />
        </div>
      );
    case 'notMember':
      return (
        <div className="app">
          <NotMember user={state.user} onRecheck={recheck} />
        </div>
      );
    case 'error':
      return (
        <div className="app">
          <div className="auth-box notice error">ログイン状態を確認できませんでした: {state.message}</div>
        </div>
      );
    case 'ready': {
      const email = emailOf(state.user);
      const name = state.member.name || state.user.displayName || email.split('@')[0];
      return (
        <DataProvider key={state.user.uid} uid={state.user.uid} email={email} displayName={name} member={state.member}>
          <Shell />
        </DataProvider>
      );
    }
  }
}
