import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type FSRS, type Grade } from 'ts-fsrs';
import { daysUntil } from './dates';
import type { SavedState } from './types';

export { Rating, State };

export const GRADES: { rating: Grade; label: string; key: string; tone: 'again' | 'hard' | 'good' }[] = [
  { rating: Rating.Again, label: 'もう一度', key: '1', tone: 'again' },
  { rating: Rating.Hard, label: 'あいまい', key: '2', tone: 'hard' },
  { rating: Rating.Good, label: '覚えた', key: '3', tone: 'good' },
];

/** 記憶の安定度がこの日数以上なら「定着」とみなす */
export const MATURE_DAYS = 21;

/**
 * 入試日が設定されていれば、次の出題日が入試日の前日を越えないよう上限を設ける。
 * 入試日を過ぎたら上限なし。
 */
export function maxIntervalFor(examDate: string | null | undefined, now: number): number {
  if (!examDate) return 36500;
  const days = daysUntil(examDate, now);
  if (days < 1) return 36500;
  return Math.max(1, days - 1);
}

export interface Scheduler {
  f: FSRS;
  maxDays: number;
}

export function makeScheduler(examDate: string | null | undefined, now: number): Scheduler {
  const maxDays = maxIntervalFor(examDate, now);
  const f = fsrs(
    generatorParameters({
      request_retention: 0.9,
      maximum_interval: maxDays,
      enable_fuzz: true,
      enable_short_term: true,
      learning_steps: ['1m', '10m'],
      relearning_steps: ['10m'],
    }),
  );
  return { f, maxDays };
}

export function toCard(s: SavedState | undefined, now: number): Card {
  if (!s) return createEmptyCard(new Date(now));
  return {
    due: new Date(s.due),
    stability: s.s,
    difficulty: s.d,
    elapsed_days: 0,
    scheduled_days: s.sd,
    learning_steps: s.ls,
    reps: s.r,
    lapses: s.l,
    state: s.st as State,
    last_review: s.lr ? new Date(s.lr) : undefined,
  };
}

export function fromCard(c: Card, prev: SavedState | undefined, now: number): SavedState {
  return {
    due: c.due.getTime(),
    s: c.stability,
    d: c.difficulty,
    st: c.state,
    sd: c.scheduled_days,
    ls: c.learning_steps,
    r: c.reps,
    l: c.lapses,
    lr: c.last_review ? c.last_review.getTime() : now,
    fr: prev?.fr ?? now,
  };
}

/** 3つのボタンそれぞれを押した場合の次の状態 */
export function previewNext(sch: Scheduler, prev: SavedState | undefined, now: number): Record<Grade, SavedState> {
  const log = sch.f.repeat(toCard(prev, now), new Date(now));
  const out = {} as Record<Grade, SavedState>;
  for (const g of GRADES) {
    let card = log[g.rating].card;
    // ts-fsrs は「あいまい」より「覚えた」の間隔を必ず長くするため、maximum_interval を超えることがある。
    // 入試日の前日を越えないよう、ここで上限をかけ直す
    if (card.scheduled_days > sch.maxDays) {
      card = { ...card, scheduled_days: sch.maxDays, due: new Date(now + sch.maxDays * 86_400_000) };
    }
    out[g.rating] = fromCard(card, prev, now);
  }
  return out;
}

export function formatInterval(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min}分`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours}時間`;
  const days = Math.round(ms / 86_400_000);
  if (days < 31) return `${days}日`;
  if (days < 365) return `${Math.round(days / 30)}か月`;
  return `${(days / 365).toFixed(1)}年`;
}

export type Level = 'new' | 'learning' | 'mature';

export function levelOf(s: SavedState | undefined): Level {
  if (!s || s.st === State.New) return 'new';
  return s.st === State.Review && s.s >= MATURE_DAYS ? 'mature' : 'learning';
}
