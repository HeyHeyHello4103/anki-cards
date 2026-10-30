import { normalize } from './scheduler';
import type { SavedState } from './types';

/** 以前の学習記録を移すためのファイル（管理者が変換して利用者に渡す） */
export interface ProgressFile {
  format: 'anki-cards-progress';
  version: 1;
  source?: string;
  states: Record<string, SavedState>;
}

const NUM_FIELDS = ['due', 'st', 'sd', 'r', 'l', 'fr'] as const;
const OPTIONAL_NUM_FIELDS = ['e', 's', 'd', 'ls'] as const;

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

function isState(v: unknown): v is SavedState {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    NUM_FIELDS.every((k) => isNum(o[k])) &&
    OPTIONAL_NUM_FIELDS.every((k) => o[k] === undefined || isNum(o[k])) &&
    (o.lr === null || typeof o.lr === 'number')
  );
}

export function parseProgressFile(text: string): ProgressFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('ファイルを読み取れませんでした。学習記録のファイル（.json）を選んでください');
  }
  const o = data as Partial<ProgressFile>;
  if (o?.format !== 'anki-cards-progress' || o.version !== 1 || !o.states || typeof o.states !== 'object') {
    throw new Error('学習記録のファイルではないようです');
  }
  const states: Record<string, SavedState> = {};
  for (const [id, st] of Object.entries(o.states)) if (isState(st)) states[id] = st;
  return { format: 'anki-cards-progress', version: 1, source: o.source, states };
}

export interface ProgressPlan {
  /** チャンクごとに書き込む学習状態 */
  writes: Record<string, Record<string, SavedState>>;
  imported: number;
  /** このサイトでの記録のほうが新しいので残したカード */
  keptNewer: number;
  /** 登録されているカードに見つからなかった記録 */
  notFound: number;
}

/** カードごとに、最後に復習した日時が新しいほうの記録を残す */
export function planProgressImport(
  incoming: Record<string, SavedState>,
  current: Record<string, SavedState>,
  chunkOf: (cardId: string) => string | undefined,
): ProgressPlan {
  const plan: ProgressPlan = { writes: {}, imported: 0, keptNewer: 0, notFound: 0 };
  for (const [id, st] of Object.entries(incoming)) {
    const chunk = chunkOf(id);
    if (!chunk) {
      plan.notFound++;
      continue;
    }
    const cur = current[id];
    if (cur && (cur.lr ?? 0) >= (st.lr ?? 0)) {
      plan.keptNewer++;
      continue;
    }
    (plan.writes[chunk] ??= {})[id] = normalize(st);
    plan.imported++;
  }
  return plan;
}
