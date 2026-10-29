import { useCallback, useState, type PointerEvent } from 'react';

export interface TipState {
  x: number;
  y: number;
  text: string;
}

/** グラフの要素にマウスを重ねる・タップすると数値を出す */
export function useTooltip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const bind = useCallback(
    (text: string) => ({
      onPointerEnter: (e: PointerEvent) => setTip({ x: e.clientX, y: e.clientY, text }),
      onPointerMove: (e: PointerEvent) => setTip({ x: e.clientX, y: e.clientY, text }),
      onPointerLeave: () => setTip(null),
    }),
    [],
  );
  const node = tip ? (
    <div className="viz-tip" role="status" style={{ left: tip.x, top: tip.y }}>
      {tip.text}
    </div>
  ) : null;
  return { bind, node };
}
