import { DAY_MS, DAY_START_HOUR, daysUntil, nextStudyDayStart, studyDayStart } from './dates';
import type { SavedState } from './types';

/**
 * 次に出す日の決め方。
 * 覚えた・あいまいは元の暗記カード（アーティファクト）と同じ：
 *   覚えた … 1日 → 3日 → その後は前回の間隔 × 易しさ係数（はじめ 2.5）
 *   あいまい … 前回の間隔 × 1.2（係数を 0.15 下げる）
 * もう一度（忘れた）だけは最初からやり直さず、10分後に覚え直してから、
 * 前回の間隔に応じた日数（afterLapse）から再開する。
 */

export const State = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const;
export type State = (typeof State)[keyof typeof State];

export const Rating = { Again: 1, Hard: 2, Good: 3 } as const;
export type Grade = (typeof Rating)[keyof typeof Rating];

export const GRADES: { rating: Grade; label: string; key: string; tone: 'again' | 'hard' | 'good' }[] = [
  { rating: Rating.Again, label: 'もう一度', key: '1', tone: 'again' },
  { rating: Rating.Hard, label: 'あいまい', key: '2', tone: 'hard' },
  { rating: Rating.Good, label: '覚えた', key: '3', tone: 'good' },
];

/** 易しさ係数（「覚えた」で間隔を何倍に伸ばすか） */
export const EASE_START = 2.5;
const EASE_MIN = 1.3;
const EASE_HARD = 0.15;
const EASE_AGAIN = 0.2;
const HARD_FACTOR = 1.2;
/** 初めてのカードで「もう一度」を押したとき、もう一度出すまで */
const NEW_AGAIN_MS = 60_000;
/** 覚えていたカードを忘れたとき、覚え直すまで */
const RELEARN_MS = 10 * 60_000;

/** 間隔がこの日数以上なら「定着」とみなす */
export const MATURE_DAYS = 21;

/**
 * 忘れたカードを覚え直したあと、次に出すまでの日数。
 * 前回の間隔が長いほど少し長くする（8日以下→1日、20日→2日、50日→4日、125日→6日）。
 */
export function afterLapse(days: number): number {
  return Math.max(1, Math.round(Math.sqrt(days) / 2));
}

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
  maxDays: number;
}

export function makeScheduler(examDate: string | null | undefined, now: number): Scheduler {
  return { maxDays: maxIntervalFor(examDate, now) };
}

const clampEase = (e: number) => Math.round(Math.min(EASE_START, Math.max(EASE_MIN, e)) * 100) / 100;

/**
 * 以前の方式（FSRS）で保存された記録を、今の方式の形にそろえる。
 * 易しさ係数は、移行時に係数から難しさを求めた式（d = 5 + (2.5 − 係数) × 4 + 0.5 × 忘れた回数）を逆にたどって戻す。
 */
export function normalize(s: SavedState): SavedState {
  if (s.e !== undefined) return s;
  const e = clampEase(EASE_START - ((s.d ?? 5) - 5 - 0.5 * s.l) / 4);
  // 元の暗記カードの期限は夜0時。このままだと1日の区切り（午前4時）の前に入り、1日早く出てしまう
  const due = new Date(s.due);
  if (s.st === State.Review && due.getHours() === 0 && due.getMinutes() === 0 && due.getSeconds() === 0 && due.getMilliseconds() === 0) {
    due.setHours(DAY_START_HOUR);
  }
  const base = { due: due.getTime(), st: s.st, e, l: s.l, lr: s.lr, fr: s.fr };
  if (s.st === State.Review) return { ...base, sd: Math.max(1, Math.round(s.sd)), r: s.sd >= 3 ? 2 : 1 };
  if (s.st === State.Relearning) return { ...base, sd: Math.max(1, Math.round(s.s ?? 1)), r: 0 };
  return { ...base, sd: 0, r: 0 };
}

/** 学習日 now から days 日後の学習日の始まり（午前4時） */
function dueAfterDays(now: number, days: number): number {
  const d = new Date(studyDayStart(now));
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** 3つのボタンそれぞれを押した場合の次の状態 */
export function previewNext(sch: Scheduler, prev: SavedState | undefined, now: number): Record<Grade, SavedState> {
  const cur: SavedState = prev
    ? normalize(prev)
    : { due: now, st: State.New, sd: 0, e: EASE_START, r: 0, l: 0, lr: null, fr: now };
  const e = cur.e ?? EASE_START;
  const base = { ...cur, lr: now, fr: prev ? cur.fr : now };
  // 何日後に出すか（sd は上限をかける前の間隔。上限は出す日だけにかける）
  const review = (sd: number, r: number, ease: number): SavedState => ({
    ...base,
    st: State.Review,
    sd,
    r,
    e: clampEase(ease),
    due: dueAfterDays(now, Math.min(sd, sch.maxDays)),
  });
  const again = (ms: number, st: State, extra: Partial<SavedState> = {}): SavedState => ({ ...base, st, due: now + ms, ...extra });

  switch (cur.st) {
    case State.Review: {
      // 苦手カードの復習などで期限前に答えた場合、覚えていれば予定はそのまま
      const early = cur.due >= nextStudyDayStart(now);
      return {
        [Rating.Again]: again(RELEARN_MS, State.Relearning, {
          sd: afterLapse(cur.sd),
          r: 0,
          l: cur.l + 1,
          e: clampEase(e - EASE_AGAIN),
        }),
        [Rating.Hard]: early
          ? { ...cur, lr: now }
          : review(cur.r === 0 ? 1 : Math.max(1, Math.round(cur.sd * HARD_FACTOR)), cur.r + 1, e - EASE_HARD),
        [Rating.Good]: early
          ? { ...cur, lr: now }
          : review(cur.r === 0 ? 1 : cur.r === 1 ? 3 : Math.round(cur.sd * e), cur.r + 1, e),
      };
    }
    case State.Relearning: {
      // 覚え直したら、前回の間隔に応じた日数から再開する（1日なら次は3日、2日以上ならそこから係数倍）
      const r = cur.sd >= 2 ? 2 : 1;
      return {
        [Rating.Again]: again(RELEARN_MS, State.Relearning),
        [Rating.Hard]: review(cur.sd, r, e - EASE_HARD),
        [Rating.Good]: review(cur.sd, r, e),
      };
    }
    default: {
      // 未学習・初めて見て「もう一度」を押したカード
      const fresh = cur.st === State.New;
      return {
        [Rating.Again]: again(NEW_AGAIN_MS, State.Learning, fresh ? { e: clampEase(e - EASE_AGAIN) } : {}),
        [Rating.Hard]: review(1, 1, e - EASE_HARD),
        [Rating.Good]: review(1, 1, e),
      };
    }
  }
}

/** 次に出すまでを「10分後」「明日」「3日後」「約2か月後」のように表す */
export function formatDue(due: number, now: number): string {
  const min = Math.round((due - now) / 60_000);
  if (min < 60 && due < nextStudyDayStart(now)) return `${Math.max(1, min)}分後`;
  const days = Math.round((studyDayStart(due) - studyDayStart(now)) / DAY_MS);
  if (days <= 0) return `${Math.max(1, Math.round(min / 60))}時間後`;
  if (days === 1) return '明日';
  if (days < 31) return `${days}日後`;
  if (days < 365) return `約${Math.round(days / 30)}か月後`;
  return `約${(days / 365).toFixed(1)}年後`;
}

export type Level = 'new' | 'learning' | 'mature';

export function levelOf(s: SavedState | undefined): Level {
  if (!s || s.st === State.New) return 'new';
  return s.st === State.Review && s.sd >= MATURE_DAYS ? 'mature' : 'learning';
}
