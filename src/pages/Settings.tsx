import { signOut } from 'firebase/auth';
import { doc, setDoc, writeBatch } from 'firebase/firestore';
import { useMemo, useState, type FormEvent } from 'react';
import { daysUntil } from '../lib/dates';
import { auth, db } from '../lib/firebase';
import { parseProgressFile, planProgressImport, type ProgressFile } from '../lib/progress';
import { maxIntervalFor } from '../lib/scheduler';
import { impOf, isUsed, newLimitFor, summarize, unitKey } from '../lib/session';
import { useData } from '../lib/store';
import type { Imp } from '../lib/types';

const IMPS: Imp[] = ['A', 'B', 'C'];

function ImpChoice({ value, onChange, label }: { value: Imp | null; onChange: (imp: Imp) => void; label: string }) {
  return (
    <span className="imp-choice" role="group" aria-label={label}>
      {IMPS.map((imp) => (
        <button key={imp} type="button" aria-pressed={value === imp} onClick={() => onChange(imp)}>
          {imp}
        </button>
      ))}
    </span>
  );
}

/** 使うセットとセットごとの重要度。押すとすぐ保存する */
function SetSettings() {
  const d = useData();
  const patch = (field: 'imp' | 'use', keys: string[], value: Imp | boolean) => {
    const values: Record<string, Imp | boolean> = {};
    for (const k of keys) values[k] = value;
    setDoc(doc(db, 'users', d.uid), { settings: { [field]: values } }, { merge: true }).catch(() => {});
  };
  if (!d.catalog || d.catalog.subjects.length === 0) return null;
  const base = d.settings.newPerDay;
  return (
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>使うセットと重要度</h2>
      <p className="small muted" style={{ margin: 0 }}>
        チェックを外したセットは、ホームや統計に出なくなります（学習記録は消えません）。ホームでは重要度の高いセットから並び、1日の新規カードの上限は A{' '}
        {newLimitFor(base, 'A')}枚・B {newLimitFor(base, 'B')}枚・C {newLimitFor(base, 'C')}枚です。
      </p>
      {d.catalog.subjects.map((s) => {
        const keys = s.units.map((u) => unitKey(s.id, u.id));
        const used = s.units.filter((u) => isUsed(d.settings.use, s.id, u.id));
        const imps = used.map((u) => impOf(d.settings.imp, s.id, u.id));
        const same = imps.length && imps.every((x) => x === imps[0]) ? imps[0] : null;
        return (
          <div key={s.id}>
            <div className="row" style={{ marginBottom: 4 }}>
              <label className="check" style={{ alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={used.length === s.units.length}
                  ref={(el) => {
                    if (el) el.indeterminate = used.length > 0 && used.length < s.units.length;
                  }}
                  onChange={(e) => patch('use', keys, e.target.checked)}
                />
                <b>{s.name}</b>
              </label>
              <span className="spacer" />
              {used.length > 1 && (
                <>
                  <span className="small muted">まとめて</span>
                  <ImpChoice
                    value={same}
                    label={`${s.name}のセットの重要度をまとめて設定`}
                    onChange={(imp) => patch('imp', used.map((u) => unitKey(s.id, u.id)), imp)}
                  />
                </>
              )}
            </div>
            {s.units.map((u) => {
              const on = isUsed(d.settings.use, s.id, u.id);
              return (
                <div className={`imp-row ${on ? '' : 'off'}`} key={u.id}>
                  <label className="check name" style={{ alignItems: 'center' }}>
                    <input type="checkbox" checked={on} onChange={(e) => patch('use', [unitKey(s.id, u.id)], e.target.checked)} />
                    <span>{u.name}</span>
                  </label>
                  {on && (
                    <ImpChoice
                      value={impOf(d.settings.imp, s.id, u.id)}
                      label={`${u.name}の重要度`}
                      onChange={(imp) => patch('imp', [unitKey(s.id, u.id)], imp)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}

/** 以前の学習記録（管理者が変換したファイル）を自分の記録として取り込む */
function ProgressImport() {
  const d = useData();
  const [file, setFile] = useState<ProgressFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const plan = useMemo(() => (file ? planProgressImport(file.states, d.states, d.chunkOf) : null), [file, d.states, d.chunkOf]);

  const onFile = async (f: File | undefined) => {
    setMsg(null);
    setFile(null);
    if (!f) return;
    try {
      setFile(parseProgressFile(await f.text()));
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  };

  const doImport = async () => {
    if (!plan || plan.imported === 0) return;
    setBusy(true);
    try {
      const merged = { ...d.states };
      const batch = writeBatch(db);
      for (const [chunk, c] of Object.entries(plan.writes)) {
        batch.set(doc(db, 'users', d.uid, 'states', chunk), { c }, { merge: true });
        Object.assign(merged, c);
      }
      batch.set(doc(db, 'users', d.uid), { sum: { subj: summarize(d.cards, merged) } }, { merge: true });
      await batch.commit();
      setMsg({ kind: 'ok', text: `${plan.imported}枚の学習記録を取り込みました` });
      setFile(null);
    } catch (e) {
      setMsg({ kind: 'error', text: `取り込みに失敗しました: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>以前の学習記録を取り込む</h2>
      <p className="small muted" style={{ margin: 0 }}>
        前に使っていた暗記カードの復習記録を変換したファイル（.json）があれば、ここで取り込めます。先にカードが登録されている必要があります。同じカードに両方の記録があるときは、最後に復習した日が新しいほうを残します。
      </p>
      <div>
        <label className="btn file-pick">
          記録のファイルを選ぶ
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {file && plan && (
        <>
          <div className="notice info">
            {file.source ? `「${file.source}」の記録 ` : ''}
            {Object.keys(file.states).length}枚分：取り込む <b>{plan.imported}</b>枚
            {plan.keptNewer > 0 && `・このサイトの記録のほうが新しいので残す ${plan.keptNewer}枚`}
            {plan.notFound > 0 && `・登録済みのカードに見つからない ${plan.notFound}枚`}
          </div>
          {d.cards.length === 0 && <div className="notice warn">カードがまだ登録されていません。管理者がカードを登録してから取り込んでください。</div>}
          <div>
            <button className="btn primary" disabled={busy || plan.imported === 0} onClick={doImport}>
              {busy ? '取り込み中…' : '取り込む'}
            </button>
          </div>
        </>
      )}
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
    </section>
  );
}

export function Settings() {
  const d = useData();
  const [examDate, setExamDate] = useState(d.settings.examDate ?? '');
  const [newPerDay, setNewPerDay] = useState(String(d.settings.newPerDay));
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = Math.round(Number(newPerDay));
    if (!Number.isFinite(n) || n < 0 || n > 500) {
      setMsg({ kind: 'error', text: '1日の新規カード数は0〜500の数字で入力してください' });
      return;
    }
    // オフラインでも端末に保存され、電波が戻ったときに送信されるので、完了を待たない
    setDoc(doc(db, 'users', d.uid), { settings: { examDate: examDate || null, newPerDay: n } }, { merge: true }).catch(
      (err: Error) => setMsg({ kind: 'error', text: `保存できませんでした: ${err.message}` }),
    );
    setMsg({ kind: 'ok', text: '保存しました' });
  };

  const days = examDate ? daysUntil(examDate, Date.now()) : null;

  return (
    <div className="stack">
      <form className="panel stack" onSubmit={save}>
        <h2 style={{ margin: 0 }}>学習の設定</h2>
        <label className="field">
          入試日（本番の日）
          <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
        </label>
        <p className="small muted" style={{ margin: 0 }}>
          {days !== null && days >= 1
            ? `入試まであと${days}日です。どのカードも入試の前日までに少なくとも1回は出題されるよう、出題の間隔を最長${maxIntervalFor(examDate, Date.now())}日にします。`
            : '入試日を設定すると、どのカードも入試の前日までに少なくとも1回は出題されるよう間隔を調整します。'}
        </p>
        <label className="field">
          1つのセットで1日に新しく学ぶカードの上限
          <input type="number" inputMode="numeric" min={0} max={500} value={newPerDay} onChange={(e) => setNewPerDay(e.target.value)} />
        </label>
        <p className="small muted" style={{ margin: 0 }}>
          重要度Aのセットはこの1.5倍、Cのセットは半分になります。新しいカードを増やしすぎると数日後の復習が一気に増えるので、最初は20枚前後がおすすめです。
        </p>
        <div className="row">
          <button className="btn primary" type="submit">
            保存
          </button>
          {msg && <span className={`notice ${msg.kind}`}>{msg.text}</span>}
        </div>
      </form>

      <SetSettings />

      <ProgressImport />

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>アカウント</h2>
        <div>
          <div className="small muted">ログイン中のメールアドレス</div>
          <div>{d.email}</div>
        </div>
        {!d.isAdmin && (
          <p className="small muted" style={{ margin: 0 }}>
            管理者は、あなたの学習状況の概要（最終学習日・回答数・科目別の定着率）を確認できます。一つ一つの回答内容は表示されません。
          </p>
        )}
        <div>
          <button className="btn" onClick={() => signOut(auth)}>
            ログアウト
          </button>
        </div>
      </section>

      <section className="panel stack small">
        <h2 style={{ margin: 0 }}>使い方</h2>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>カードの表を見て答えを思い出してから、タップして答えを確認します。</li>
          <li>思い出せなければ「もう一度」、時間がかかった・一部だけなら「あいまい」、すぐ思い出せたら「覚えた」を押します。</li>
          <li>次に出題する日は、記憶の定着具合に合わせて自動で決まります（FSRS方式）。毎日少しずつ続けるのが一番効果的です。</li>
          <li>1日の区切りは午前4時です。夜遅くの学習はその日の分として数えます。</li>
          <li>スマホではブラウザのメニューから「ホーム画面に追加」すると、アプリのように使えます。</li>
        </ul>
      </section>
    </div>
  );
}
