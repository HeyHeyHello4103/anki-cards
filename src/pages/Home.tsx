import { useMemo, useState } from 'react';
import { dayKey, daysUntil } from '../lib/dates';
import { go } from '../lib/router';
import { levelOf } from '../lib/scheduler';
import { countDue, newStudiedToday } from '../lib/session';
import { useData } from '../lib/store';
import type { CardData } from '../lib/types';

function groupCards(cards: CardData[]) {
  const bySubject = new Map<string, CardData[]>();
  const byUnit = new Map<string, CardData[]>();
  for (const c of cards) {
    bySubject.set(c.s, [...(bySubject.get(c.s) ?? []), c]);
    const k = c.s + '/' + c.u;
    byUnit.set(k, [...(byUnit.get(k) ?? []), c]);
  }
  return { bySubject, byUnit };
}

function DuePills({ learn, review, fresh }: { learn: number; review: number; fresh: number }) {
  const due = learn + review;
  return (
    <>
      {due > 0 && <span className="pill due">復習 {due}</span>}
      {fresh > 0 && <span className="pill">新規 {fresh}</span>}
      {due === 0 && fresh === 0 && <span className="pill">完了</span>}
    </>
  );
}

export function Home() {
  const d = useData();
  const now = Date.now();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Record<string, Set<string>>>({});
  const { bySubject, byUnit } = useMemo(() => groupCards(d.cards), [d.cards]);

  const newLeft = Math.max(0, d.settings.newPerDay - newStudiedToday(d.states, now));
  const total = countDue(d.cards, d.states, now, newLeft);
  const todayCount = d.act[dayKey(now)]?.n ?? 0;
  const examDays = d.settings.examDate ? daysUntil(d.settings.examDate, now) : null;

  if (!d.catalog || d.cards.length === 0) {
    return (
      <div className="panel stack">
        <h2>カードがまだありません</h2>
        <p className="muted" style={{ margin: 0 }}>
          管理者がカードを登録すると、ここに科目と単元が表示されます。
        </p>
        {d.isAdmin && (
          <a className="btn primary" href="#/admin">
            カードを登録する
          </a>
        )}
      </div>
    );
  }

  const toggleOpen = (sid: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(sid)) n.delete(sid);
      else n.add(sid);
      return n;
    });
  const togglePick = (sid: string, uid: string) =>
    setPicked((p) => {
      const cur = new Set(p[sid] ?? []);
      if (cur.has(uid)) cur.delete(uid);
      else cur.add(uid);
      return { ...p, [sid]: cur };
    });

  return (
    <div className="stack">
      <section className="panel hero">
        <div className="row">
          <h2 style={{ margin: 0 }}>今日の学習</h2>
          <span className="spacer" />
          {examDays !== null && examDays >= 0 && (
            <span className="exam-chip">
              入試まで あと <b>{examDays}</b> 日
            </span>
          )}
        </div>
        <div className="counts">
          <div className="count">
            <b>{total.learn + total.review}</b>
            <span>復習</span>
          </div>
          <div className="count">
            <b>{total.fresh}</b>
            <span>新規（残り{newLeft}枚まで）</span>
          </div>
          <div className="count">
            <b>{todayCount}</b>
            <span>今日の回答数</span>
          </div>
        </div>
        <button
          className="btn primary big block"
          onClick={() => go('/study/all')}
          disabled={total.learn + total.review + total.fresh === 0}
        >
          {total.learn + total.review + total.fresh === 0 ? '今日の分は終わりました' : 'すべての科目で学習を始める'}
        </button>
      </section>

      <section className="panel">
        <h2>科目・単元を選んで学習</h2>
        {d.catalog.subjects.map((s) => {
          const list = bySubject.get(s.id) ?? [];
          const c = countDue(list, d.states, now, newLeft);
          const mature = list.filter((x) => levelOf(d.states[x.id]) === 'mature').length;
          const isOpen = open.has(s.id);
          const sel = picked[s.id] ?? new Set<string>();
          return (
            <div className="subject" key={s.id}>
              <button className="subject-head" onClick={() => toggleOpen(s.id)} aria-expanded={isOpen}>
                <svg className={`chev ${isOpen ? 'open' : ''}`} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="subject-name">{s.name}</span>
                <span className="small muted">
                  {list.length}枚・定着{list.length ? Math.round((mature / list.length) * 100) : 0}%
                </span>
                <span className="spacer" />
                <DuePills learn={c.learn} review={c.review} fresh={c.fresh} />
              </button>
              {isOpen && (
                <>
                  <div className="units">
                    {s.units.map((u) => {
                      const uc = countDue(byUnit.get(s.id + '/' + u.id) ?? [], d.states, now, newLeft);
                      return (
                        <label className="unit" key={u.id}>
                          <input type="checkbox" checked={sel.has(u.id)} onChange={() => togglePick(s.id, u.id)} />
                          <span className="name">{u.name}</span>
                          <DuePills learn={uc.learn} review={uc.review} fresh={uc.fresh} />
                        </label>
                      );
                    })}
                  </div>
                  <div className="row" style={{ marginLeft: 20 }}>
                    <button className="btn small primary" onClick={() => go(`/study/s/${s.id}`)}>
                      {s.name}をすべて学習
                    </button>
                    <button
                      className="btn small"
                      disabled={sel.size === 0}
                      onClick={() => go(`/study/u/${s.id}/${[...sel].join(',')}`)}
                    >
                      選んだ単元を学習{sel.size > 0 && `（${sel.size}）`}
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </section>
      {d.isAdmin ? null : (
        <p className="small muted center" style={{ margin: 0 }}>
          学習状況の概要（回答数・定着率など）は管理者も確認できます。
        </p>
      )}
    </div>
  );
}
