import { collection, deleteDoc, doc, getDocs, onSnapshot, setDoc, writeBatch } from 'firebase/firestore';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { decodeText, downloadCsv, parseDelimited } from '../lib/csv';
import { addDays, dayKey, formatRelative } from '../lib/dates';
import { db } from '../lib/firebase';
import {
  exportRows,
  planImport,
  readRows,
  TEMPLATE_ROWS,
  validateRows,
  type Field,
  type ImportPlan,
  type ImportRow,
  type Issue,
} from '../lib/importer';
import { useData } from '../lib/store';
import type { MemberDoc, Role, UserDoc } from '../lib/types';

export function Admin({ tab }: { tab: string }) {
  const d = useData();
  if (!d.isAdmin) return <div className="notice error">管理者だけが使える画面です。</div>;
  const tabs = [
    ['cards', 'カード', '#/admin'],
    ['members', '利用者', '#/admin/members'],
    ['progress', '学習状況', '#/admin/progress'],
  ];
  return (
    <div className="stack">
      <nav className="tabs">
        {tabs.map(([key, label, href]) => (
          <a key={key} href={href} aria-current={tab === key ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </nav>
      {tab === 'members' ? <Members /> : tab === 'progress' ? <Progress /> : <Cards />}
    </div>
  );
}

const FIELD_LABEL: Record<Field, string> = {
  id: 'ID',
  subject: '科目',
  unit: 'セット',
  section: '区分',
  front: '表',
  back: '裏',
  note: '解説',
  tags: 'タグ',
};

/** Firestore の1回の書き込みは10MiBまでなので、大きいときは分けて送る */
async function commitPlan(plan: ImportPlan) {
  const enc = new TextEncoder();
  const ops: { size: number; apply: (b: ReturnType<typeof writeBatch>) => void }[] = [];
  for (const [id, chunk] of Object.entries(plan.write)) {
    ops.push({ size: enc.encode(JSON.stringify(chunk)).length, apply: (b) => b.set(doc(db, 'cards', id), chunk) });
  }
  for (const id of plan.remove) ops.push({ size: 100, apply: (b) => b.delete(doc(db, 'cards', id)) });
  // 科目一覧は最後に更新する
  ops.push({ size: 50_000, apply: (b) => b.set(doc(db, 'catalog', 'main'), plan.catalog) });
  let batch = writeBatch(db);
  let size = 0;
  let count = 0;
  for (const op of ops) {
    if (count > 0 && (size + op.size > 6_000_000 || count >= 400)) {
      await batch.commit();
      batch = writeBatch(db);
      size = 0;
      count = 0;
    }
    op.apply(batch);
    size += op.size;
    count++;
  }
  await batch.commit();
}

function Cards() {
  const d = useData();
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][] | null>(null);
  const [defaults, setDefaults] = useState({ subject: '', unit: '' });
  const [deleteMissing, setDeleteMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const existing = useMemo(() => {
    const m = new Map<string, { card: (typeof d.cards)[number]; subjectName: string }>();
    for (const c of d.cards) m.set(c.id, { card: c, subjectName: d.subjectName(c.s) });
    return m;
  }, [d]);

  const parsed = useMemo(() => (table ? readRows(table, defaults) : null), [table, defaults]);
  const issues: Issue[] = useMemo(
    () => (parsed && parsed.missingColumns.length === 0 ? validateRows(parsed.rows, existing) : []),
    [parsed, existing],
  );
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  const plan = useMemo(
    () =>
      parsed && parsed.missingColumns.length === 0 && errors.length === 0
        ? planImport(parsed.rows, d.catalog, d.chunks, { deleteMissing })
        : null,
    [parsed, errors.length, d.catalog, d.chunks, deleteMissing],
  );

  const onFile = async (file: File | undefined) => {
    setResult(null);
    if (!file) return;
    setFileName(file.name);
    setTable(parseDelimited(decodeText(await file.arrayBuffer())));
  };

  const doImport = async () => {
    if (!plan) return;
    if (plan.deleted > 0 && !confirm(`${plan.deleted}枚のカードを削除します。よろしいですか？`)) return;
    setBusy(true);
    try {
      await commitPlan(plan);
      setResult({
        kind: 'ok',
        text: `取り込みました（追加 ${plan.added}枚・更新 ${plan.updated}枚・変更なし ${plan.unchanged}枚${plan.deleted ? `・削除 ${plan.deleted}枚` : ''}）`,
      });
      setTable(null);
      setFileName('');
    } catch (e) {
      setResult({ kind: 'error', text: `取り込みに失敗しました: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  const needDefaults = parsed && (parsed.columns.subject === undefined || parsed.columns.unit === undefined);

  return (
    <div className="stack">
      <section className="panel">
        <h2>登録済みのカード</h2>
        {d.catalog && d.catalog.subjects.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>科目</th>
                  <th className="num">セット数</th>
                  <th className="num">カード数</th>
                </tr>
              </thead>
              <tbody>
                {d.catalog.subjects.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="num">{s.units.length}</td>
                    <td className="num">{s.count}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <b>合計</b>
                  </td>
                  <td />
                  <td className="num">
                    <b>{d.catalog.total}</b>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            まだありません。下からCSVファイルを取り込んでください。
          </p>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="btn small"
            disabled={d.cards.length === 0}
            onClick={() => downloadCsv(`cards-${dayKey(Date.now())}.csv`, exportRows(d.catalog, d.cards))}
          >
            登録済みカードをCSVで書き出す
          </button>
          <button className="btn small" onClick={() => downloadCsv('cards-template.csv', TEMPLATE_ROWS)}>
            記入用のひな形をダウンロード
          </button>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          カードを直すときは、書き出したCSVを編集して取り込み直してください。ID列が同じカードは上書きされ、学習記録も引き継がれます。
        </p>
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>CSVを取り込む</h2>
        <p className="small muted" style={{ margin: 0 }}>
          1行目に見出し（ID・科目・セット・区分・表・裏・解説・タグ）を入れてください。表と裏は必須です。区分を入れると、セットを開いたときにその区分で絞り込めます。数式は <code>$x^2$</code>、化学式は{' '}
          <code>{'\\ce{H2O}'}</code> のように書けます。Excelで保存したCSV（Shift_JIS・UTF-8のどちらも可）やタブ区切りのファイルも読めます。
        </p>
        <div>
          <label className="btn file-pick">
            CSVファイルを選ぶ
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                // 同じファイルを直して選び直したときも読み込めるようにする
                e.target.value = '';
              }}
            />
          </label>
        </div>

        {parsed && (
          <>
            <div className="small">
              <b>{fileName}</b>：{parsed.rows.length}行を読み込みました。
              認識した列：
              {(Object.keys(parsed.columns) as Field[]).map((f) => FIELD_LABEL[f]).join('・') || 'なし'}
            </div>
            {needDefaults && (
              <div className="row">
                {parsed.columns.subject === undefined && (
                  <label className="field" style={{ flex: 1, minWidth: 140 }}>
                    科目名（科目の列がないため）
                    <input type="text" value={defaults.subject} onChange={(e) => setDefaults({ ...defaults, subject: e.target.value })} />
                  </label>
                )}
                {parsed.columns.unit === undefined && (
                  <label className="field" style={{ flex: 1, minWidth: 140 }}>
                    セット名（セットの列がないため。空欄なら「全般」）
                    <input type="text" value={defaults.unit} onChange={(e) => setDefaults({ ...defaults, unit: e.target.value })} />
                  </label>
                )}
              </div>
            )}
            {parsed.missingColumns.length > 0 && (
              <div className="notice error">
                {parsed.missingColumns.map((f) => FIELD_LABEL[f]).join('・')}
                {parsed.missingColumns.includes('subject') && parsed.missingColumns.length === 1
                  ? 'の名前を入力してください。'
                  : 'の列が見つかりません。1行目の見出しを確認してください。'}
              </div>
            )}
            {parsed.missingColumns.length === 0 && (
              <>
                <IssueList issues={issues} rows={parsed.rows} />
                {errors.length === 0 && plan && (
                  <div className="notice info">
                    取り込むと：追加 <b>{plan.added}</b>枚・更新 <b>{plan.updated}</b>枚・変更なし {plan.unchanged}枚
                    {deleteMissing && (
                      <>
                        ・削除 <b>{plan.deleted}</b>枚
                      </>
                    )}
                    {warns.length > 0 && '（要確認の項目はそのまま取り込めますが、内容を確認してください）'}
                  </div>
                )}
                <label className="check">
                  <input type="checkbox" checked={deleteMissing} onChange={(e) => setDeleteMissing(e.target.checked)} />
                  <span>このファイルにない登録済みカードを削除する（書き出したCSVを編集して取り込み直すとき用）</span>
                </label>
                <div>
                  <button className="btn primary" disabled={busy || !plan || errors.length > 0} onClick={doImport}>
                    {busy ? '取り込み中…' : '取り込む'}
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {result && <div className={`notice ${result.kind}`}>{result.text}</div>}
      </section>
    </div>
  );
}

function IssueList({ issues, rows }: { issues: Issue[]; rows: ImportRow[] }) {
  if (rows.length === 0) return <div className="notice error">データの行がありません。</div>;
  if (issues.length === 0) return <div className="notice ok">点検の結果、問題は見つかりませんでした。</div>;
  const errors = issues.filter((i) => i.level === 'error').length;
  const kinds = new Map<string, number>();
  for (const i of issues) kinds.set(i.kind, (kinds.get(i.kind) ?? 0) + 1);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className={`notice ${errors ? 'error' : 'warn'}`}>
        {errors > 0 ? `修正が必要な項目が${errors}件あります。直してから取り込んでください。` : '確認したほうがよい項目があります。'}
        （{[...kinds].map(([k, n]) => `${k} ${n}件`).join('・')}）
      </div>
      <ul className="issue-list">
        {issues.slice(0, 300).map((i, idx) => (
          <li key={idx}>
            <span className={`tag ${i.level}`}>{i.level === 'error' ? '要修正' : '要確認'}</span>
            {i.lines.length > 0 && <span className="muted">{i.lines.slice(0, 8).join('・')}行目：</span>}
            {i.message}
          </li>
        ))}
        {issues.length > 300 && <li className="muted">ほか{issues.length - 300}件</li>}
      </ul>
    </div>
  );
}

function Members() {
  const d = useData();
  const [members, setMembers] = useState<Record<string, MemberDoc> | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(
    () =>
      onSnapshot(
        collection(db, 'members'),
        (q) => {
          const m: Record<string, MemberDoc> = {};
          q.forEach((x) => (m[x.id] = x.data() as MemberDoc));
          setMembers(m);
        },
        (e) => setMsg({ kind: 'error', text: e.message }),
      ),
    [],
  );

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const key = email.trim().toLowerCase();
    if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(key)) {
      setMsg({ kind: 'error', text: 'メールアドレスの形式が正しくありません' });
      return;
    }
    try {
      await setDoc(doc(db, 'members', key), { role, name: name.trim(), addedAt: Date.now() });
      setMsg({ kind: 'ok', text: `${key} を登録しました。このメールアドレスでログインすると使えるようになります。` });
      setEmail('');
      setName('');
      setRole('member');
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message });
    }
  };

  const remove = async (key: string) => {
    if (!confirm(`${key} の登録を解除します。この人はログインしても使えなくなります（学習記録は残ります）。よろしいですか？`)) return;
    await deleteDoc(doc(db, 'members', key)).catch((err: Error) => setMsg({ kind: 'error', text: err.message }));
  };

  const list = Object.entries(members ?? {}).sort((a, b) => (a[1].addedAt ?? 0) - (b[1].addedAt ?? 0));

  return (
    <div className="stack">
      <form className="panel stack" onSubmit={add}>
        <h2 style={{ margin: 0 }}>利用者を追加</h2>
        <p className="small muted" style={{ margin: 0 }}>
          登録したメールアドレスでログインした人だけが使えます。Googleでログインする人はそのGoogleアカウントのアドレスを登録してください。
        </p>
        <label className="field">
          メールアドレス
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <div className="row">
          <label className="field" style={{ flex: 2, minWidth: 160 }}>
            表示名（学習状況の一覧に出ます）
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field" style={{ flex: 1, minWidth: 120 }}>
            権限
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="member">利用者</option>
              <option value="admin">管理者</option>
            </select>
          </label>
        </div>
        <div>
          <button className="btn primary" type="submit">
            登録
          </button>
        </div>
        {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
      </form>

      <section className="panel">
        <h2>登録済みの利用者（{list.length}人）</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>表示名</th>
                <th>メールアドレス</th>
                <th>権限</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map(([key, m]) => (
                <tr key={key}>
                  <td>{m.name || '—'}</td>
                  <td style={{ wordBreak: 'break-all' }}>{key}</td>
                  <td>{m.role === 'admin' ? '管理者' : '利用者'}</td>
                  <td className="num">
                    {key === d.email ? (
                      <span className="small muted">あなた</span>
                    ) : (
                      <button className="btn small danger" onClick={() => remove(key)}>
                        解除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Progress() {
  const d = useData();
  const [users, setUsers] = useState<(UserDoc & { uid: string })[] | null>(null);
  const [members, setMembers] = useState<Record<string, MemberDoc>>({});
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const [u, m] = await Promise.all([getDocs(collection(db, 'users')), getDocs(collection(db, 'members'))]);
      setUsers(u.docs.map((x) => ({ uid: x.id, ...(x.data() as UserDoc) })));
      const mm: Record<string, MemberDoc> = {};
      m.forEach((x) => (mm[x.id] = x.data() as MemberDoc));
      setMembers(mm);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const now = Date.now();
  const today = dayKey(now);
  const subjects = d.catalog?.subjects ?? [];
  const totalCards = d.catalog?.total ?? 0;

  const rows = (users ?? [])
    .map((u) => {
      const week = Array.from({ length: 7 }, (_, i) => u.act?.[addDays(today, -i)]?.n ?? 0).reduce((a, b) => a + b, 0);
      const mature = Object.values(u.sum?.subj ?? {}).reduce((n, s) => n + s.m, 0);
      const email = (u.email ?? '').toLowerCase();
      return { ...u, email, label: members[email]?.name || u.name || email, week, mature };
    })
    .sort((a, b) => (b.sum?.last ?? 0) - (a.sum?.last ?? 0));
  const neverLoggedIn = Object.keys(members).filter((e) => !rows.some((r) => r.email === e));

  return (
    <div className="stack">
      <section className="panel">
        <div className="row" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>利用者ごとの学習状況</h2>
          <span className="spacer" />
          <button className="btn small" onClick={load}>
            更新
          </button>
        </div>
        {error && <div className="notice error">{error}</div>}
        {!users ? (
          <p className="muted">読み込み中…</p>
        ) : rows.length === 0 ? (
          <p className="muted">まだ誰も学習していません。</p>
        ) : (
          rows.map((r) => (
            <div className="user-card" key={r.uid}>
              <div className="row">
                <b>{r.label}</b>
                {r.label !== r.email && <span className="small muted">{r.email}</span>}
              </div>
              <div className="user-stats">
                <span>
                  最終学習 <b>{formatRelative(r.sum?.last, now)}</b>
                </span>
                <span>
                  直近7日 <b>{r.week}</b>枚
                </span>
                <span>
                  総回答 <b>{(r.sum?.total ?? 0).toLocaleString()}</b>枚
                </span>
                <span>
                  定着 <b>{r.mature}</b>/{totalCards}枚
                </span>
              </div>
              <div className="chips">
                {subjects.map((s) => {
                  const m = r.sum?.subj?.[s.id]?.m ?? 0;
                  return (
                    <span className="pill" key={s.id}>
                      {s.name} {s.count ? Math.round((m / s.count) * 100) : 0}%
                    </span>
                  );
                })}
              </div>
            </div>
          ))
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>
          パーセントは科目ごとの定着率（記憶がおよそ3週間以上もつと見込まれるカードの割合）です。各自が学習した時点の値です。
        </p>
        {neverLoggedIn.length > 0 && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            まだ一度もログインしていない利用者：{neverLoggedIn.map((e) => members[e]?.name || e).join('、')}
          </p>
        )}
      </section>
    </div>
  );
}
