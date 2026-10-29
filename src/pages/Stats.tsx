import { useMemo } from 'react';
import { ForecastChart, Heatmap, MasteryBars, type MasteryRow } from '../components/Charts';
import { addDays, dayKey, formatDayJa, parseYmd } from '../lib/dates';
import { plainText } from '../lib/render';
import { levelOf } from '../lib/scheduler';
import { forecast } from '../lib/session';
import { useData } from '../lib/store';
import type { DayAct } from '../lib/types';

/** 今日（まだなら昨日）から遡って、続けて学習した日数 */
export function streakOf(act: Record<string, DayAct>, today: string): number {
  let day = (act[today]?.n ?? 0) > 0 ? today : addDays(today, -1);
  let n = 0;
  while ((act[day]?.n ?? 0) > 0) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function Stats() {
  const d = useData();
  const now = Date.now();
  const today = dayKey(now);

  const rows: MasteryRow[] = useMemo(() => {
    const m = new Map<string, MasteryRow>();
    for (const s of d.catalog?.subjects ?? []) m.set(s.id, { id: s.id, name: s.name, total: 0, learning: 0, mature: 0 });
    for (const c of d.cards) {
      const r = m.get(c.s);
      if (!r) continue;
      r.total++;
      const lv = levelOf(d.states[c.id]);
      if (lv === 'mature') r.mature++;
      else if (lv === 'learning') r.learning++;
    }
    return [...m.values()].filter((r) => r.total > 0);
  }, [d.catalog, d.cards, d.states]);

  const fc = forecast(d.cards, d.states, now);
  const fcKeys = fc.map((_, i) => addDays(today, i));
  const fcLabels = fcKeys.map((k, i) => (i === 0 ? '今日' : i === 1 ? '明日' : WEEKDAYS[parseYmd(k).getDay()]));

  const weak = useMemo(
    () =>
      d.cards
        .filter((c) => (d.states[c.id]?.l ?? 0) > 0)
        .sort((a, b) => d.states[b.id].l - d.states[a.id].l)
        .slice(0, 20),
    [d.cards, d.states],
  );

  const mature = rows.reduce((n, r) => n + r.mature, 0);
  const total = rows.reduce((n, r) => n + r.total, 0);
  const last30 = Array.from({ length: 30 }, (_, i) => d.act[addDays(today, -i)]?.n ?? 0);
  const studiedDays = last30.filter((n) => n > 0).length;
  const allAnswers = Object.values(d.act).reduce((n, a) => n + a.n, 0);

  return (
    <div className="stack">
      <div className="tiles">
        <div className="tile">
          <div className="label">今日の回答数</div>
          <div className="value">
            {d.act[today]?.n ?? 0}
            <small>枚</small>
          </div>
        </div>
        <div className="tile">
          <div className="label">連続学習</div>
          <div className="value">
            {streakOf(d.act, today)}
            <small>日</small>
          </div>
        </div>
        <div className="tile">
          <div className="label">定着したカード</div>
          <div className="value">
            {mature}
            <small>/ {total}枚</small>
          </div>
        </div>
        <div className="tile">
          <div className="label">これまでの回答数</div>
          <div className="value">
            {allAnswers.toLocaleString()}
            <small>枚</small>
          </div>
        </div>
      </div>

      <section className="panel">
        <h2>学習カレンダー</h2>
        <Heatmap act={d.act} today={today} />
        <p className="small muted" style={{ margin: '8px 0 0' }}>
          直近30日のうち {studiedDays} 日学習、合計 {last30.reduce((a, b) => a + b, 0)} 枚
        </p>
      </section>

      <section className="panel">
        <h2>科目別の定着状況</h2>
        {rows.length ? <MasteryBars rows={rows} /> : <p className="muted">カードがまだありません</p>}
        <p className="small muted" style={{ margin: 0 }}>
          「定着」は、記憶がおよそ3週間以上もつと見込まれるカードです。
        </p>
      </section>

      <section className="panel">
        <h2>今後7日間の復習予定</h2>
        <ForecastChart values={fc} labels={fcLabels} titles={fcKeys.map(formatDayJa)} />
      </section>

      <section className="panel">
        <div className="row" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>苦手カード</h2>
          <span className="spacer" />
          {weak.length > 0 && (
            <a className="btn small primary" href="#/study/weak">
              苦手カードを復習
            </a>
          )}
        </div>
        {weak.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            覚えたあとで忘れたカードがここに表示されます。
          </p>
        ) : (
          <ul className="weak-list">
            {weak.map((c) => (
              <li key={c.id}>
                <div className="q">
                  <div>{plainText(c.f)}</div>
                  <div className="a">
                    {plainText(c.b, 40)}・{d.subjectName(c.s)}
                  </div>
                </div>
                <span className="pill">{d.states[c.id].l}回忘れた</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
