import { useMemo, useState } from 'react';
import { Rich } from '../components/Rich';
import { breakdown, SetBar, SetBarNums } from '../components/Breakdown';
import { nextStudyDayStart } from '../lib/dates';
import { formatDue, levelOf, type Level } from '../lib/scheduler';
import { impOf, sectionsOf } from '../lib/session';
import { useData } from '../lib/store';
import type { CardData, SavedState } from '../lib/types';
import { ImpBadge } from './Home';

/** 一度に描く枚数（多いセットでもスマホで重くならないように） */
const PAGE = 150;

const LEVEL_LABEL: Record<Level, string> = { new: '未学習', learning: '学習中', mature: '定着' };

/** カードに付いている重要度（タグの「重要度A」など） */
const cardImp = (c: CardData) => c.t?.find((t) => /^重要度[ABC]$/.test(t))?.slice(-1) ?? '';

function statusOf(s: SavedState | undefined, now: number): string {
  if (!s || s.st === 0) return '未学習';
  if (s.due < nextStudyDayStart(now)) return '今日の復習';
  return `次は${formatDue(s.due, now)}`;
}

function Chips<T extends string>(props: { label: string; items: { value: T; text: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="chip-row">
      <span className="chip-label">{props.label}</span>
      <div className="chips">
        {props.items.map((it) => (
          <button key={it.value} className="chip" aria-pressed={props.value === it.value} onClick={() => props.onChange(it.value)}>
            {it.text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** セットのカードを一覧で見る（元の暗記カードの「一覧」と同じく、絞り込みと「答えを隠す」つき） */
export function SetList({ subject, unit }: { subject: string; unit: string }) {
  const d = useData();
  const now = Date.now();
  const cards = useMemo(() => d.cards.filter((c) => c.s === subject && c.u === unit), [d.cards, subject, unit]);
  const sections = useMemo(() => sectionsOf(cards), [cards]);
  const [section, setSection] = useState('*');
  const [imp, setImp] = useState('*');
  const [level, setLevel] = useState<'*' | Level>('*');
  const [q, setQ] = useState('');
  const [hide, setHide] = useState(false);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);

  const levels = useMemo(() => new Map(cards.map((c) => [c.id, levelOf(d.states[c.id])])), [cards, d.states]);
  const imps = ['A', 'B', 'C'].filter((k) => cards.some((c) => cardImp(c) === k));
  const needle = q.trim().toLowerCase();

  // 区分・重要度で絞った範囲（定着度のボタンの枚数はこの範囲で数える）
  const base = cards.filter((c) => (section === '*' || (c.c ?? '') === section) && (imp === '*' || cardImp(c) === imp));
  const filtered = base.filter(
    (c) =>
      (level === '*' || levels.get(c.id) === level) &&
      (!needle || `${c.f}\n${c.b}\n${c.n ?? ''}`.toLowerCase().includes(needle)),
  );
  const count = (lv: Level) => base.filter((c) => levels.get(c.id) === lv).length;
  const mature = count('mature');
  const learning = count('learning');

  // 区分ごとにまとめて表示する
  const groups = sections
    .map((name) => ({ name, rows: filtered.filter((c) => (c.c ?? '') === name) }))
    .filter((g) => g.rows.length > 0);
  let budget = limit;

  const reset = () => setLimit(PAGE);

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row">
          <a className="btn small" href={`#/study/u/${subject}/${unit}`}>
            ← セットへ戻る
          </a>
        </div>
        <div className="row">
          <ImpBadge imp={impOf(d.settings.imp, subject, unit)} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="small muted">{d.subjectName(subject)}</div>
            <h2 style={{ margin: 0 }}>{d.unitName(subject, unit)} の一覧</h2>
          </div>
        </div>
        <SetBar segs={breakdown(mature, learning, base.length - mature - learning)} />
        <SetBarNums segs={breakdown(mature, learning, base.length - mature - learning)} />

        {sections.length > 1 && (
          <Chips
            label="区分"
            value={section}
            onChange={(v) => (setSection(v), reset())}
            items={[{ value: '*', text: 'すべて' }, ...sections.map((x) => ({ value: x, text: `${x || '（区分なし）'}（${cards.filter((c) => (c.c ?? '') === x).length}）` }))]}
          />
        )}
        {imps.length > 0 && (
          <Chips
            label="重要度"
            value={imp}
            onChange={(v) => (setImp(v), reset())}
            items={[{ value: '*', text: 'すべて' }, ...imps.map((k) => ({ value: k, text: `${k}（${cards.filter((c) => cardImp(c) === k).length}）` }))]}
          />
        )}
        <Chips
          label="定着度"
          value={level}
          onChange={(v) => (setLevel(v), reset())}
          items={[
            { value: '*', text: 'すべて' },
            ...(['new', 'learning', 'mature'] as Level[]).map((lv) => ({ value: lv, text: `${LEVEL_LABEL[lv]}（${count(lv)}）` })),
          ]}
        />
        <div className="row">
          <input type="search" placeholder="表・裏・解説の文字で探す" value={q} onChange={(e) => (setQ(e.target.value), reset())} style={{ flex: 1, minWidth: 180 }} />
          <button className="btn small" aria-pressed={hide} onClick={() => (setHide(!hide), setShown(new Set()))}>
            {hide ? '答えを表示する' : '答えを隠す'}
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {filtered.length}枚{hide && '・カードを押すと答えが出ます'}
        </p>
      </section>

      {groups.map((g) => {
        if (budget <= 0) return null;
        const rows = g.rows.slice(0, budget);
        budget -= rows.length;
        return (
          <section className="panel list-group" key={g.name || '(none)'}>
            {sections.length > 1 && (
              <h3 className="list-head">
                {g.name || '（区分なし）'}
                <span className="small muted">{g.rows.length}枚</span>
              </h3>
            )}
            {rows.map((c) => {
              const open = !hide || shown.has(c.id);
              const ci = cardImp(c);
              return (
                <div
                  key={c.id}
                  className={`list-row ${hide ? 'tappable' : ''}`}
                  onClick={
                    hide
                      ? () =>
                          setShown((p) => {
                            const n = new Set(p);
                            if (n.has(c.id)) n.delete(c.id);
                            else n.add(c.id);
                            return n;
                          })
                      : undefined
                  }
                >
                  <div className="list-q">
                    <Rich className="list-front" text={c.f} />
                    <div className="list-meta">
                      {ci && <span className={`imp imp-${ci} mini`}>{ci}</span>}
                      <span>{statusOf(d.states[c.id], now)}</span>
                      {(d.states[c.id]?.l ?? 0) > 0 && <span>・{d.states[c.id].l}回忘れた</span>}
                    </div>
                  </div>
                  <div className="list-a">
                    {open ? (
                      <>
                        <Rich className="list-back" text={c.b} />
                        {c.n && <Rich className="list-note" text={c.n} />}
                      </>
                    ) : (
                      <span className="list-hidden">答えを見る</span>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
      {filtered.length > limit && (
        <button className="btn block" onClick={() => setLimit(limit + PAGE)}>
          さらに表示（残り{filtered.length - limit}枚）
        </button>
      )}
      {filtered.length === 0 && <p className="muted center">当てはまるカードはありません</p>}
    </div>
  );
}
