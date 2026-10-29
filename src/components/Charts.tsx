import { addDays, formatDayJa, parseYmd } from '../lib/dates';
import type { DayAct } from '../lib/types';
import { useTooltip } from './Tooltip';
import { useWidth } from './useWidth';

const HEAT_STEPS = [1, 20, 50, 100];
const heatLevel = (n: number) => HEAT_STEPS.filter((t) => n >= t).length;
const HEAT_LEGEND = ['0枚', '1〜19枚', '20〜49枚', '50〜99枚', '100枚以上'];

/** 日ごとの回答数を色の濃さで表すカレンダー（列が週、行が曜日）。表示する週数は画面幅に合わせる */
export function Heatmap({ act, today }: { act: Record<string, DayAct>; today: string }) {
  const { bind, node } = useTooltip();
  const [ref, boxWidth] = useWidth<HTMLDivElement>(300);
  const cell = 12;
  const step = 15;
  const left = 20;
  const top = 16;
  const weeks = Math.max(8, Math.min(53, Math.floor((boxWidth - left) / step)));
  const end = parseYmd(today);
  const firstSunday = addDays(today, -end.getDay() - (weeks - 1) * 7);

  const cells: { key: string; x: number; y: number; n: number }[] = [];
  const months: { x: number; label: string }[] = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const key = addDays(firstSunday, w * 7 + d);
      if (key > today) continue;
      const date = parseYmd(key);
      if (date.getDate() === 1 || (w === 0 && d === 0)) months.push({ x: left + w * step, label: `${date.getMonth() + 1}月` });
      cells.push({ key, x: left + w * step, y: top + d * step, n: act[key]?.n ?? 0 });
    }
  }
  // 月の見出しが重ならないよう、近すぎるものは省く
  const monthLabels = months.filter((m, i) => i === 0 || m.x - months[i - 1].x >= step * 3);
  const width = left + weeks * step;
  const height = top + 7 * step;

  return (
    <div>
      <div className="heatmap-wrap" ref={ref}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="日ごとの回答数">
          {monthLabels.map((m) => (
            <text key={m.x} x={m.x} y={10} fontSize={10} fill="var(--text-2)">
              {m.label}
            </text>
          ))}
          {['月', '水', '金'].map((w, i) => (
            <text key={w} x={0} y={top + (1 + i * 2) * step + 9} fontSize={10} fill="var(--text-2)">
              {w}
            </text>
          ))}
          {cells.map((c) => (
            <g key={c.key} {...bind(`${formatDayJa(c.key)}　${c.n}枚`)}>
              <rect x={c.x - 1.5} y={c.y - 1.5} width={step} height={step} fill="transparent" />
              <rect
                x={c.x}
                y={c.y}
                width={cell}
                height={cell}
                rx={2}
                fill={`var(--heat-${heatLevel(c.n)})`}
                stroke={c.key === today ? 'var(--text-2)' : 'none'}
                strokeWidth={1}
              />
            </g>
          ))}
        </svg>
      </div>
      <div className="legend" style={{ marginTop: 8, marginBottom: 0 }}>
        {HEAT_LEGEND.map((label, i) => (
          <span key={label}>
            <i style={{ background: `var(--heat-${i})` }} />
            {label}
          </span>
        ))}
      </div>
      {node}
    </div>
  );
}

export interface MasteryRow {
  id: string;
  name: string;
  total: number;
  learning: number;
  mature: number;
}

/** 科目ごとの「定着／学習中／未学習」の内訳 */
export function MasteryBars({ rows }: { rows: MasteryRow[] }) {
  const { bind, node } = useTooltip();
  return (
    <div>
      <div className="legend">
        <span>
          <i style={{ background: 'var(--viz-mature)' }} />
          定着
        </span>
        <span>
          <i style={{ background: 'var(--viz-learning)' }} />
          学習中
        </span>
        <span>
          <i style={{ background: 'var(--viz-track)' }} />
          未学習
        </span>
      </div>
      {rows.map((r) => {
        const unseen = r.total - r.learning - r.mature;
        const segs = [
          { label: '定着', n: r.mature, color: 'var(--viz-mature)' },
          { label: '学習中', n: r.learning, color: 'var(--viz-learning)' },
          { label: '未学習', n: unseen, color: 'var(--viz-track)' },
        ].filter((s) => s.n > 0);
        const pct = r.total ? Math.round((r.mature / r.total) * 100) : 0;
        return (
          <div className="mastery-row" key={r.id}>
            <div className="head">
              <span className="name">{r.name}</span>
              <span className="pct">定着率 {pct}%</span>
            </div>
            <div className="stackbar" role="img" aria-label={`${r.name}: 定着${r.mature}枚、学習中${r.learning}枚、未学習${unseen}枚`}>
              {segs.map((s) => (
                <div
                  key={s.label}
                  style={{ flexGrow: s.n, flexBasis: 0, background: s.color }}
                  {...bind(`${r.name}　${s.label} ${s.n}枚（${Math.round((s.n / r.total) * 100)}%）`)}
                />
              ))}
            </div>
            <div className="nums">
              定着 {r.mature}・学習中 {r.learning}・未学習 {unseen}（全{r.total}枚）
            </div>
          </div>
        );
      })}
      {node}
    </div>
  );
}

/** 上の角だけ丸めた棒 */
function columnPath(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** 今後の復習予定（日ごとの枚数） */
export function ForecastChart({ values, labels, titles }: { values: number[]; labels: string[]; titles: string[] }) {
  const { bind, node } = useTooltip();
  const [ref, boxWidth] = useWidth<HTMLDivElement>(320);
  const W = Math.min(560, Math.max(240, boxWidth));
  const H = 150;
  const top = 18;
  const bottom = 24;
  const plotH = H - top - bottom;
  const band = W / values.length;
  const barW = Math.min(24, band * 0.6);
  const max = Math.max(1, ...values);
  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="今後7日間の復習予定" style={{ display: 'block' }}>
        <line x1={0} x2={W} y1={top + plotH + 0.5} y2={top + plotH + 0.5} stroke="var(--border)" strokeWidth={1} />
        {values.map((v, i) => {
          const h = v === 0 ? 0 : Math.max(2, (v / max) * plotH);
          const x = i * band + (band - barW) / 2;
          const y = top + plotH - h;
          return (
            <g key={i} {...bind(`${titles[i]}　${v}枚`)}>
              <rect x={i * band} y={0} width={band} height={H} fill="transparent" />
              {h > 0 && <path d={columnPath(x, y, barW, h, 4)} fill="var(--viz-bar)" />}
              <text x={i * band + band / 2} y={y - 5} fontSize={11} textAnchor="middle" fill="var(--text-2)">
                {v}
              </text>
              <text x={i * band + band / 2} y={H - 6} fontSize={11} textAnchor="middle" fill="var(--text-2)">
                {labels[i]}
              </text>
            </g>
          );
        })}
      </svg>
      {node}
    </div>
  );
}
