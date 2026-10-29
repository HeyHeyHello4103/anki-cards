import { useEffect, useMemo, useState } from 'react';
import { go } from '../lib/router';
import { countDue, impOf, newLimitFor, newStudiedToday, sectionsOf } from '../lib/session';
import { useData } from '../lib/store';
import { ImpBadge } from './Home';

const storeKey = (subject: string, unit: string) => `sections:${subject}_${unit}`;

/** 前回選んだ区分（この端末だけで覚えておく） */
function loadSelection(subject: string, unit: string, sections: string[]): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey(subject, unit)) ?? 'null');
    if (Array.isArray(saved)) {
      const picked = sections.filter((s) => saved.includes(s));
      if (picked.length) return new Set(picked);
    }
  } catch {
    // 保存できない環境では毎回すべて選んだ状態から始める
  }
  return new Set(sections);
}

/** セットを開いたときの画面。区分（例：第1問〜第6問）を選んでから学習を始める */
export function SetStart({ subject, unit }: { subject: string; unit: string }) {
  const d = useData();
  const now = Date.now();
  const cards = useMemo(() => d.cards.filter((c) => c.s === subject && c.u === unit), [d.cards, subject, unit]);
  const sections = useMemo(() => sectionsOf(cards), [cards]);
  const [picked, setPicked] = useState(() => loadSelection(subject, unit, sections));

  // 区分が1つしかないセットは、選ぶ画面を出さずにそのまま始める
  useEffect(() => {
    if (cards.length && sections.length < 2) location.replace(`#/study/u/${subject}/${unit}/go/all`);
  }, [cards.length, sections.length, subject, unit]);

  if (!cards.length) {
    return (
      <div className="panel stack">
        <h2 style={{ margin: 0 }}>このセットは見つかりませんでした</h2>
        <a className="btn" href="#/">
          ホームへ
        </a>
      </div>
    );
  }
  if (sections.length < 2) return <div className="spinner" aria-label="読み込み中" />;

  const imp = impOf(d.settings.imp, subject, unit);
  const newLeft = Math.max(0, newLimitFor(d.settings.newPerDay, imp) - newStudiedToday(cards, d.states, now));
  const rows = sections.map((name) => {
    const list = cards.filter((c) => (c.c ?? '') === name);
    const due = countDue(list, d.states, now, Infinity);
    return { name, total: list.length, due: due.learn + due.review, unseen: due.unseen };
  });
  const chosen = rows.filter((r) => picked.has(r.name));
  const dueSum = chosen.reduce((n, r) => n + r.due, 0);
  const freshSum = Math.min(newLeft, chosen.reduce((n, r) => n + r.unseen, 0));
  const weak = cards.some((c) => (d.states[c.id]?.l ?? 0) > 0);

  const toggle = (name: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  const start = () => {
    try {
      localStorage.setItem(storeKey(subject, unit), JSON.stringify([...picked]));
    } catch {
      // 保存できなくても学習は始められる
    }
    const sel = picked.size === sections.length ? 'all' : sections.flatMap((s, i) => (picked.has(s) ? [i] : [])).join(',');
    go(`/study/u/${subject}/${unit}/go/${sel}`);
  };

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row">
          <ImpBadge imp={imp} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="small muted">{d.subjectName(subject)}</div>
            <h2 style={{ margin: 0 }}>{d.unitName(subject, unit)}</h2>
          </div>
        </div>
        <div className="counts">
          <div className="count">
            <b>{dueSum}</b>
            <span>復習</span>
          </div>
          <div className="count">
            <b>{freshSum}</b>
            <span>新規（今日あと{newLeft}枚まで）</span>
          </div>
        </div>
        <button className="btn primary big block" disabled={picked.size === 0 || dueSum + freshSum === 0} onClick={start}>
          {picked.size === 0 ? '区分を選んでください' : dueSum + freshSum === 0 ? '選んだ区分の今日の分は終わりました' : 'この区分で学習を始める'}
        </button>
        {weak && (
          <a className="btn small" href={`#/study/weak/${subject}/${unit}`} style={{ alignSelf: 'flex-start' }}>
            このセットの苦手カードを復習
          </a>
        )}
      </section>

      <section className="panel">
        <div className="row" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>区分を選ぶ</h2>
          <span className="spacer" />
          <button className="btn small" onClick={() => setPicked(new Set(sections))}>
            すべて
          </button>
          <button className="btn small" onClick={() => setPicked(new Set())}>
            外す
          </button>
        </div>
        <div className="section-list">
          {rows.map((r) => (
            <label className="section-row" key={r.name}>
              <input type="checkbox" checked={picked.has(r.name)} onChange={() => toggle(r.name)} />
              <span className="section-name">{r.name || '（区分なし）'}</span>
              <span className="section-nums">
                <span className={r.due ? 'due' : ''}>復習 {r.due}</span>
                <span>
                  未学習 {r.unseen}／{r.total}枚
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
