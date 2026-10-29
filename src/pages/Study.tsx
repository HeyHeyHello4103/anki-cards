import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Grade } from 'ts-fsrs';
import { Rich } from '../components/Rich';
import { dayKey, nextStudyDayStart } from '../lib/dates';
import { go } from '../lib/router';
import { formatInterval, GRADES, makeScheduler, previewNext, Rating, State } from '../lib/scheduler';
import { buildQueue, inScope, newStudiedToday, type Scope } from '../lib/session';
import { useData } from '../lib/store';
import type { SavedState } from '../lib/types';

interface Session {
  main: string[];
  /** このセッション中にもう一度出す（学習中の）カード */
  learn: { id: string; due: number }[];
  current: string | null;
  revealed: boolean;
  answered: number;
  tally: { again: number; hard: number; good: number };
}

interface HistoryItem {
  id: string;
  prev: SavedState | undefined;
  rating: Grade;
  day: string;
  before: Session;
}

function pickNext(s: Session, now: number): Session {
  const learn = [...s.learn].sort((a, b) => a.due - b.due);
  if (learn.length && learn[0].due <= now) {
    return { ...s, learn: learn.slice(1), current: learn[0].id, revealed: false };
  }
  if (s.main.length) return { ...s, learn, main: s.main.slice(1), current: s.main[0], revealed: false };
  if (learn.length) return { ...s, learn: learn.slice(1), current: learn[0].id, revealed: false };
  return { ...s, learn, current: null, revealed: false };
}

const kindOf = (st: SavedState | undefined): 'new' | 'learn' | 'review' =>
  !st || st.st === State.New ? 'new' : st.st === State.Review ? 'review' : 'learn';

export function Study({ scope }: { scope: Scope }) {
  const d = useData();
  const scheduler = useMemo(() => makeScheduler(d.settings.examDate, Date.now()), [d.settings.examDate]);

  const [session, setSession] = useState<Session>(() => {
    const now = Date.now();
    const newLeft = Math.max(0, d.settings.newPerDay - newStudiedToday(d.states, now));
    const q = buildQueue(
      d.cards.filter((c) => inScope(c, scope)),
      d.states,
      now,
      newLeft,
      scope.kind === 'weak' ? 'weak' : 'due',
    );
    const learn = q.learn.map((id) => ({ id, due: d.states[id].due }));
    return pickNext(
      { main: q.main, learn, current: null, revealed: false, answered: 0, tally: { again: 0, hard: 0, good: 0 } },
      now,
    );
  });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [startTotal] = useState(() => session.main.length + session.learn.length + (session.current ? 1 : 0));

  // 画面を離れるときに保存
  useEffect(() => () => d.sync.flush(), [d.sync]);

  const card = session.current ? d.cardById.get(session.current) : undefined;
  const prev = session.current ? d.states[session.current] : undefined;
  const now = Date.now();
  const options = useMemo(
    // 答えを表示した時点で、各ボタンを押した場合の次回出題までの間隔を計算しておく
    () => (session.current && session.revealed ? previewNext(scheduler, prev, now) : null),
    [session.current, session.revealed, scheduler],
  );

  const reveal = useCallback(() => setSession((s) => (s.current ? { ...s, revealed: true } : s)), []);

  const answer = useCallback(
    (rating: Grade) => {
      if (!session.current || !session.revealed) return;
      const id = session.current;
      const t = Date.now();
      const before = d.states[id];
      const next = previewNext(scheduler, before, t)[rating];
      const day = dayKey(t);
      d.sync.record(id, next, day, {
        n: 1,
        a: rating === Rating.Again ? 1 : 0,
        nw: kindOf(before) === 'new' ? 1 : 0,
      });
      setHistory((h) => [...h.slice(-29), { id, prev: before, rating, day, before: session }]);
      const stillLearning =
        (next.st === State.Learning || next.st === State.Relearning) && next.due < nextStudyDayStart(t);
      const key = rating === Rating.Again ? 'again' : rating === Rating.Hard ? 'hard' : 'good';
      setSession(
        pickNext(
          {
            ...session,
            learn: stillLearning ? [...session.learn, { id, due: next.due }] : session.learn,
            answered: session.answered + 1,
            tally: { ...session.tally, [key]: session.tally[key] + 1 },
          },
          t,
        ),
      );
    },
    [session, d.states, d.sync, scheduler],
  );

  const undo = useCallback(() => {
    const last = history[history.length - 1];
    if (!last) return;
    d.sync.record(last.id, last.prev ?? null, last.day, {
      n: -1,
      a: last.rating === Rating.Again ? -1 : 0,
      nw: kindOf(last.prev) === 'new' ? -1 : 0,
    });
    setHistory((h) => h.slice(0, -1));
    setSession({ ...last.before, revealed: false });
  }, [history, d.sync]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') go('/');
      else if (e.key === 'z') undo();
      else if (!session.revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        reveal();
      } else if (session.revealed) {
        const g = GRADES.find((x) => x.key === e.key);
        if (g) answer(g.rating);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session.revealed, reveal, answer, undo]);

  // 残り枚数（今出しているカードを含む）
  const remain = { new: 0, learn: session.learn.length, review: 0 };
  for (const id of session.main) {
    const k = kindOf(d.states[id]);
    remain[k === 'new' ? 'new' : k === 'learn' ? 'learn' : 'review']++;
  }
  const curKind = session.current ? kindOf(prev) : null;
  if (curKind) remain[curKind === 'new' ? 'new' : curKind === 'learn' ? 'learn' : 'review']++;
  const left = remain.new + remain.learn + remain.review;
  const progress = startTotal ? Math.min(1, session.answered / (session.answered + left)) : 1;

  if (!session.current || !card) {
    return (
      <div className="study">
        <div className="panel stack center" style={{ marginTop: 24 }}>
          {session.answered === 0 ? (
            <>
              <h2>{scope.kind === 'weak' ? '苦手カードはありません' : '今学習するカードはありません'}</h2>
              <p className="muted" style={{ margin: 0 }}>
                {scope.kind === 'weak'
                  ? '覚えたあとで忘れた（復習で「もう一度」を押した）カードがここに集まります。'
                  : 'この範囲の今日の分は終わっています。'}
              </p>
            </>
          ) : (
            <>
              <h2>おつかれさまでした</h2>
              <div className="counts" style={{ justifyContent: 'center' }}>
                <div className="count">
                  <b>{session.answered}</b>
                  <span>回答</span>
                </div>
                <div className="count">
                  <b>{session.tally.good}</b>
                  <span>覚えた</span>
                </div>
                <div className="count">
                  <b>{session.tally.hard}</b>
                  <span>あいまい</span>
                </div>
                <div className="count">
                  <b>{session.tally.again}</b>
                  <span>もう一度</span>
                </div>
              </div>
            </>
          )}
          <div className="row" style={{ justifyContent: 'center' }}>
            {history.length > 0 && (
              <button className="btn" onClick={undo}>
                最後の回答を取り消す
              </button>
            )}
            <a className="btn primary" href="#/">
              ホームへ
            </a>
          </div>
        </div>
      </div>
    );
  }

  const crumb = `${d.subjectName(card.s)} › ${d.unitName(card.s, card.u)}`;

  return (
    <div className="study">
      <div className="study-top">
        <a href="#/" className="btn small" aria-label="学習をやめてホームへ">
          ← やめる
        </a>
        <span className="spacer" />
        <div className="remain" aria-label="残り枚数">
          <span className={curKind === 'new' ? 'cur' : ''}>新規 {remain.new}</span>
          <span className={curKind === 'learn' ? 'cur' : ''}>学習中 {remain.learn}</span>
          <span className={curKind === 'review' ? 'cur' : ''}>復習 {remain.review}</span>
        </div>
        <button className="btn small" onClick={undo} disabled={history.length === 0} title="直前の回答を取り消す（Z）">
          ↶ 戻す
        </button>
      </div>
      <div className="progress" aria-hidden="true">
        <div style={{ width: `${progress * 100}%` }} />
      </div>

      <div
        className="flashcard"
        onClick={session.revealed ? undefined : reveal}
        role={session.revealed ? undefined : 'button'}
        tabIndex={session.revealed ? undefined : 0}
        aria-label={session.revealed ? undefined : '答えを見る'}
      >
        <div className="crumb">
          {crumb}
          {curKind === 'new' && '・はじめて'}
          {prev && prev.l >= 2 && `・これまでに${prev.l}回忘れたカード`}
        </div>
        <Rich className="face" text={card.f} />
        {session.revealed ? (
          <>
            <hr className="divider" />
            <Rich className="face answer" text={card.b} />
            {card.n && <Rich className="note" text={card.n} />}
          </>
        ) : (
          <div className="tap-hint">タップ（またはスペースキー）で答えを見る</div>
        )}
      </div>

      {session.revealed && options ? (
        <div className="grades">
          {GRADES.map((g) => (
            <button key={g.key} className={`grade ${g.tone}`} onClick={() => answer(g.rating)}>
              <b>{g.label}</b>
              <span>{formatInterval(options[g.rating].due - now)}後</span>
            </button>
          ))}
        </div>
      ) : (
        <button className="btn primary big block" onClick={reveal}>
          答えを見る
        </button>
      )}
      <p className="kbd center" style={{ margin: 0 }}>
        キーボード: スペース＝答えを見る／1・2・3＝評価／Z＝戻す／Esc＝やめる
      </p>
    </div>
  );
}
