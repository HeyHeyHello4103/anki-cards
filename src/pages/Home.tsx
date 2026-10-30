import { useMemo } from 'react';
import { dayKey, daysUntil } from '../lib/dates';
import { go } from '../lib/router';
import { levelOf } from '../lib/scheduler';
import { byImp, countDue, impOf, isUsed, newLimitFor, newStudiedToday } from '../lib/session';
import { useData } from '../lib/store';
import { breakdown, SetBar, SetBarNums } from '../components/Breakdown';
import type { CardData, Imp, UnitMeta } from '../lib/types';

const IMPS: Imp[] = ['A', 'B', 'C'];

export function ImpBadge({ imp }: { imp: Imp }) {
  return (
    <span className={`imp imp-${imp}`} aria-label={`重要度${imp}`}>
      {imp}
    </span>
  );
}

/** セットの今日の枚数。復習を大きく、新規を小さく出す */
function SetDue({ learn, review, fresh }: { learn: number; review: number; fresh: number }) {
  const due = learn + review;
  return (
    <span className="set-due">
      <span className="set-due-main">
        <span className="lbl">復習</span>
        <b className={due ? '' : 'zero'}>{due}</b>
      </span>
      <span className="set-due-sub">{fresh > 0 ? `新規 ${fresh}` : due === 0 ? '今日は完了' : ''}</span>
    </span>
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

  // 利用者が「使わない」にしたセットは出さない（科目のセットが全部「使わない」なら科目ごと出さない）
  const hiddenCount = d.catalog.subjects.reduce(
    (n, s) => n + s.units.filter((u) => !isUsed(d.settings.use, s.id, u.id)).length,
    0,
  );
  // セットごとの今日の枚数（新規の上限はセットごと・重要度で変わる）
  const setRow = (subjectId: string, u: UnitMeta) => {
    const cards = byUnit.get(subjectId + '/' + u.id) ?? [];
    const imp = impOf(d.settings.imp, subjectId, u.id);
    const newLeft = Math.max(0, newLimitFor(d.settings.newPerDay, imp) - newStudiedToday(cards, d.states, now));
    let mature = 0;
    let learning = 0;
    for (const c of cards) {
      const lv = levelOf(d.states[c.id]);
      if (lv === 'mature') mature++;
      else if (lv === 'learning') learning++;
    }
    return { unit: u, imp, cards, mature, learning, due: countDue(cards, d.states, now, newLeft) };
  };
  const sets = d.catalog.subjects
    .map((subject) => ({
      subject,
      units: byImp(
        subject.units.filter((u) => isUsed(d.settings.use, subject.id, u.id)).map((u) => setRow(subject.id, u)),
        (x) => x.imp,
      ),
    }))
    .filter((x) => x.units.length > 0);
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
            {units.map(({ unit, imp, cards, mature, learning, due }) => {
              const segs = breakdown(mature, learning, cards.length - mature - learning);
              return (
                <button key={unit.id} className="set-row" onClick={() => go(`/study/u/${subject.id}/${unit.id}`)}>
                  <ImpBadge imp={imp} />
                  <span className="set-name">{unit.name}</span>
                  {imp === 'A' ? (
                    <SetBar segs={segs} />
                  ) : (
                    <span className="set-meta">
                      {cards.length}枚・定着 {cards.length ? Math.round((mature / cards.length) * 100) : 0}%
                    </span>
                  )}
                  <SetDue learn={due.learn} review={due.review} fresh={due.fresh} />
                  <svg className="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {imp === 'A' && <SetBarNums segs={segs} />}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {sets.length === 0 && (
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>使うセットが選ばれていません</h2>
          <a className="btn primary" href="#/settings">
            設定で使うセットを選ぶ
          </a>
        </div>
      )}
      {hiddenCount > 0 && (
        <p className="small muted center" style={{ margin: 0 }}>
          使わないセットが{hiddenCount}件あります（<a href="#/settings">設定</a>で変えられます）
        </p>
      )}
      {d.isAdmin ? null : (
        <p className="small muted center" style={{ margin: 0 }}>
          学習状況の概要（回答数・定着率など）は管理者も確認できます。
        </p>
      )}
    </div>
  );
}
