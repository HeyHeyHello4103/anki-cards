import { useMemo } from 'react';
import { dayKey, daysUntil } from '../lib/dates';
import { go } from '../lib/router';
import { levelOf } from '../lib/scheduler';
import { byImp, countDue, impOf, newLimitFor, newStudiedToday } from '../lib/session';
import { useData } from '../lib/store';
import type { CardData, Imp } from '../lib/types';

const IMPS: Imp[] = ['A', 'B', 'C'];

export function ImpBadge({ imp }: { imp: Imp }) {
  return (
    <span className={`imp imp-${imp}`} aria-label={`重要度${imp}`}>
      {imp}
    </span>
  );
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
  const byUnit = useMemo(() => {
    const m = new Map<string, CardData[]>();
    for (const c of d.cards) {
      const k = c.s + '/' + c.u;
      const list = m.get(k);
      if (list) list.push(c);
      else m.set(k, [c]);
    }
    return m;
  }, [d.cards]);

  if (!d.catalog || d.cards.length === 0) {
    return (
      <div className="panel stack">
        <h2>カードがまだありません</h2>
        <p className="muted" style={{ margin: 0 }}>
          管理者がカードを登録すると、ここにセットが表示されます。
        </p>
        {d.isAdmin && (
          <a className="btn primary" href="#/admin">
            カードを登録する
          </a>
        )}
      </div>
    );
  }

  // セットごとの今日の枚数（新規の上限はセットごと・重要度で変わる）
  const sets = d.catalog.subjects.map((s) => ({
    subject: s,
    units: byImp(
      s.units.map((u) => {
        const cards = byUnit.get(s.id + '/' + u.id) ?? [];
        const imp = impOf(d.settings.imp, s.id, u.id);
        const newLeft = Math.max(0, newLimitFor(d.settings.newPerDay, imp) - newStudiedToday(cards, d.states, now));
        const mature = cards.filter((c) => levelOf(d.states[c.id]) === 'mature').length;
        return { unit: u, imp, cards, mature, due: countDue(cards, d.states, now, newLeft) };
      }),
      (x) => x.imp,
    ),
  }));
  const totals = sets
    .flatMap((s) => s.units)
    .reduce((t, u) => ({ due: t.due + u.due.learn + u.due.review, fresh: t.fresh + u.due.fresh }), { due: 0, fresh: 0 });
  // 今日の復習の枚数を、科目 × セットの重要度で数える
  const dueTable = sets.map(({ subject, units }) => {
    const byImpCount: Record<Imp, number> = { A: 0, B: 0, C: 0 };
    for (const u of units) byImpCount[u.imp] += u.due.learn + u.due.review;
    return { subject, byImpCount, total: byImpCount.A + byImpCount.B + byImpCount.C };
  });
  const impTotals: Record<Imp, number> = { A: 0, B: 0, C: 0 };
  for (const r of dueTable) for (const imp of IMPS) impTotals[imp] += r.byImpCount[imp];
  const todayCount = d.act[dayKey(now)]?.n ?? 0;
  const examDays = d.settings.examDate ? daysUntil(d.settings.examDate, now) : null;

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
            <b>{totals.fresh}</b>
            <span>新規（全セット）</span>
          </div>
          <div className="count">
            <b>{todayCount}</b>
            <span>今日の回答数</span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data due-table">
            <caption>今日の復習（科目別・重要度別）</caption>
            <thead>
              <tr>
                <th>科目</th>
                {IMPS.map((imp) => (
                  <th key={imp} className="num">
                    <ImpBadge imp={imp} />
                  </th>
                ))}
                <th className="num">計</th>
              </tr>
            </thead>
            <tbody>
              {dueTable.map(({ subject, byImpCount, total }) => (
                <tr key={subject.id}>
                  <td>{subject.name}</td>
                  {IMPS.map((imp) => (
                    <td key={imp} className={`num ${byImpCount[imp] ? '' : 'zero'}`}>
                      {byImpCount[imp] || '–'}
                    </td>
                  ))}
                  <td className={`num total ${total ? '' : 'zero'}`}>{total || '–'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>計</td>
                {IMPS.map((imp) => (
                  <td key={imp} className={`num ${impTotals[imp] ? '' : 'zero'}`}>
                    {impTotals[imp] || '–'}
                  </td>
                ))}
                <td className="num total">{totals.due}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          学習するセットを下から選んでください。重要度は「設定」で変えられます。
        </p>
      </section>

      {sets.map(({ subject, units }) => (
        <section className="panel" key={subject.id}>
          <h2>{subject.name}</h2>
          <div className="set-list">
            {units.map(({ unit, imp, cards, mature, due }) => (
              <button key={unit.id} className="set-row" onClick={() => go(`/study/u/${subject.id}/${unit.id}`)}>
                <ImpBadge imp={imp} />
                <span className="set-name">
                  <span>{unit.name}</span>
                  <span className="small muted">
                    {cards.length}枚・定着{cards.length ? Math.round((mature / cards.length) * 100) : 0}%
                  </span>
                </span>
                <span className="set-pills">
                  <DuePills learn={due.learn} review={due.review} fresh={due.fresh} />
                </span>
                <svg className="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ))}
          </div>
        </section>
      ))}
      {d.isAdmin ? null : (
        <p className="small muted center" style={{ margin: 0 }}>
          学習状況の概要（回答数・定着率など）は管理者も確認できます。
        </p>
      )}
    </div>
  );
}
