import { useAuthState, emailOf } from './lib/auth';
import { configured } from './lib/firebase';
import { useRoute } from './lib/router';
import { sectionsOf, type Scope } from './lib/session';
import { DataProvider, useData } from './lib/store';
import { Admin } from './pages/Admin';
import { Home } from './pages/Home';
import { Login, NotMember, VerifyEmail } from './pages/Login';
import { SetStart } from './pages/SetStart';
import { Settings } from './pages/Settings';
import { Stats } from './pages/Stats';
import { Study } from './pages/Study';

/**
 * #/study/u/{科目}/{セット}/go/{区分}  … 学習（区分は all か、区分の番号をカンマ区切り）
 * #/study/weak/{科目}/{セット}          … 苦手カードの復習
 */
function scopeFrom(route: string[], sectionsFor: (subject: string, unit: string) => string[]): Scope | null {
  const [, kind, subject, unit, goWord, sel] = route;
  if (!subject || !unit) return null;
  if (kind === 'weak') return { kind: 'weak', subject, unit };
  if (kind !== 'u' || goWord !== 'go') return null;
  if (!sel || sel === 'all') return { kind: 'unit', subject, unit };
  const all = sectionsFor(subject, unit);
  const sections = sel
    .split(',')
    .map((i) => all[Number(i)])
    .filter((x): x is string => x !== undefined);
  return { kind: 'unit', subject, unit, sections: sections.length ? sections : undefined };
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

  const scope =
    page === 'study'
      ? scopeFrom(route, (subject, unit) => sectionsOf(d.cards.filter((c) => c.s === subject && c.u === unit)))
      : null;
  if (scope) {
    return (
      <div className="app">
        <div style={{ height: 'calc(12px + env(safe-area-inset-top))' }} />
        {/* key を変えて、範囲が変わったら学習を最初から組み立て直す */}
        <Study key={route.join('/')} scope={scope} />
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
        {page === 'study' && route[1] === 'u' && route[2] && route[3] ? (
          <SetStart key={route[2] + '/' + route[3]} subject={route[2]} unit={route[3]} />
        ) : page === 'stats' ? (
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
