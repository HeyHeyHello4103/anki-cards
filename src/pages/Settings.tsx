import { signOut } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { useState, type FormEvent } from 'react';
import { daysUntil } from '../lib/dates';
import { auth, db } from '../lib/firebase';
import { maxIntervalFor } from '../lib/scheduler';
import { useData } from '../lib/store';

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
          1日に新しく学ぶカードの上限
          <input type="number" inputMode="numeric" min={0} max={500} value={newPerDay} onChange={(e) => setNewPerDay(e.target.value)} />
        </label>
        <p className="small muted" style={{ margin: 0 }}>
          新しいカードを増やしすぎると、数日後の復習が一気に増えます。最初は20枚前後がおすすめです。
        </p>
        <div className="row">
          <button className="btn primary" type="submit">
            保存
          </button>
          {msg && <span className={`notice ${msg.kind}`}>{msg.text}</span>}
        </div>
      </form>

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
