/** 定着・学習中・未学習の内訳（ホームの重要度Aのセットと、学習中の画面で使う） */
export type Breakdown = { label: string; n: number; color: string }[];

export function breakdown(mature: number, learning: number, unseen: number): Breakdown {
  return [
    { label: '定着', n: mature, color: 'var(--viz-mature)' },
    { label: '学習中', n: learning, color: 'var(--viz-learning)' },
    { label: '未学習', n: unseen, color: 'var(--viz-track)' },
  ];
}

/** 内訳の棒 */
export function SetBar({ segs }: { segs: Breakdown }) {
  return (
    <span className="set-bar stackbar thin" role="img" aria-label={segs.map((x) => `${x.label}${x.n}枚`).join('、')}>
      {segs
        .filter((x) => x.n > 0)
        .map((x) => (
          <span key={x.label} style={{ flexGrow: x.n, flexBasis: 0, background: x.color }} />
        ))}
    </span>
  );
}

export function SetBarNums({ segs }: { segs: Breakdown }) {
  return (
    <span className="set-bar-nums" aria-hidden="true">
      {segs.map((x) => (
        <span key={x.label}>
          <i style={{ background: x.color }} />
          {x.label} {x.n}
        </span>
      ))}
    </span>
  );
}
