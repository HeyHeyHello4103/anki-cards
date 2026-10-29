import { nextStudyDayStart, studyDayStart } from './dates';
import { levelOf, State } from './scheduler';
import type { CardData, Imp, SavedState, SubjectSummary } from './types';

/** 学習の範囲。学習は1つのセット（単元）ずつ行う */
export type Scope = { kind: 'unit' | 'weak'; subject: string; unit: string };

export function inScope(card: CardData, scope: Scope): boolean {
  return card.s === scope.subject && card.u === scope.unit;
}

/** 単元の重要度を引くためのキー */
export const unitKey = (subject: string, unit: string) => `${subject}_${unit}`;

export function impOf(imp: Record<string, Imp> | undefined, subject: string, unit: string): Imp {
  return imp?.[unitKey(subject, unit)] ?? 'B';
}

const IMP_RANK: Record<Imp, number> = { A: 0, B: 1, C: 2 };

/** 重要度の高い順（同じ重要度なら元の順）に並べる */
export function byImp<T>(items: T[], imp: (item: T) => Imp): T[] {
  return items.map((x, i) => ({ x, i })).sort((a, b) => IMP_RANK[imp(a.x)] - IMP_RANK[imp(b.x)] || a.i - b.i).map((v) => v.x);
}

/** セットの1日の新規カードの上限。A は基本の1.5倍、C は半分 */
export function newLimitFor(base: number, imp: Imp): number {
  return imp === 'A' ? Math.round(base * 1.5) : imp === 'C' ? Math.round(base / 2) : base;
}

/** cards のうち、今日はじめて学習したカードの数 */
export function newStudiedToday(cards: CardData[], states: Record<string, SavedState>, now: number): number {
  const start = studyDayStart(now);
  let n = 0;
  for (const c of cards) if ((states[c.id]?.fr ?? 0) >= start) n++;
  return n;
}

const isLearning = (s: SavedState) => s.st === State.Learning || s.st === State.Relearning;

export interface DueCounts {
  /** 学習中（覚えている途中で、今日もう一度出す） */
  learn: number;
  /** 復習 */
  review: number;
  /** 新規（今日の上限を考慮した数） */
  fresh: number;
  /** 未学習の総数 */
  unseen: number;
}

export function countDue(cards: CardData[], states: Record<string, SavedState>, now: number, newLeft: number): DueCounts {
  const end = nextStudyDayStart(now);
  let learn = 0;
  let review = 0;
  let unseen = 0;
  for (const c of cards) {
    const s = states[c.id];
    if (!s || s.st === State.New) unseen++;
    else if (s.due < end) isLearning(s) ? learn++ : review++;
  }
  return { learn, review, unseen, fresh: Math.min(unseen, Math.max(0, newLeft)) };
}

export interface Queue {
  learn: string[];
  main: string[];
  freshCount: number;
}

/**
 * 出題順を決める。
 * 学習中のカードを先に、そのあと復習カード（期限の古い順）の間に新規カードを一定間隔で混ぜる。
 * 新規カードは並び順（重要度の高いカードが先）のまま出す。
 */
export function buildQueue(
  cards: CardData[],
  states: Record<string, SavedState>,
  now: number,
  newLeft: number,
  mode: 'due' | 'weak' = 'due',
): Queue {
  if (mode === 'weak') {
    const weak = cards
      .filter((c) => (states[c.id]?.l ?? 0) > 0)
      .sort((a, b) => states[b.id].l - states[a.id].l || states[a.id].due - states[b.id].due)
      .slice(0, 50)
      .map((c) => c.id);
    return { learn: [], main: weak, freshCount: 0 };
  }
  const end = nextStudyDayStart(now);
  const learn: { id: string; due: number }[] = [];
  const review: { id: string; due: number }[] = [];
  const fresh: string[] = [];
  for (const c of cards) {
    const s = states[c.id];
    if (!s || s.st === State.New) {
      if (fresh.length < newLeft) fresh.push(c.id);
    } else if (s.due < end) {
      (isLearning(s) ? learn : review).push({ id: c.id, due: s.due });
    }
  }
  learn.sort((a, b) => a.due - b.due);
  review.sort((a, b) => a.due - b.due);
  return { learn: learn.map((x) => x.id), main: interleave(review.map((x) => x.id), fresh, 4), freshCount: fresh.length };
}

/** 復習カード every 枚ごとに新規カードを1枚はさむ。片方が尽きたら残りを続ける */
export function interleave(review: string[], fresh: string[], every: number): string[] {
  const out: string[] = [];
  let r = 0;
  let f = 0;
  while (r < review.length || f < fresh.length) {
    for (let k = 0; k < every && r < review.length; k++) out.push(review[r++]);
    if (f < fresh.length) out.push(fresh[f++]);
    if (r >= review.length) while (f < fresh.length) out.push(fresh[f++]);
  }
  return out;
}

/** 7日先までの日ごとの復習予定数（index 0 が今日。期限切れは今日に含める） */
export function forecast(cards: CardData[], states: Record<string, SavedState>, now: number, days = 7): number[] {
  const out = new Array(days).fill(0);
  const start = studyDayStart(now);
  for (const c of cards) {
    const s = states[c.id];
    if (!s || s.st === State.New) continue;
    const idx = Math.max(0, Math.floor((s.due - start) / 86_400_000));
    if (idx < days) out[idx]++;
  }
  return out;
}

/** 科目ごとの「学習中」「定着」の枚数（管理者の学習状況一覧に出す） */
export function summarize(cards: CardData[], states: Record<string, SavedState>): Record<string, SubjectSummary> {
  const out: Record<string, SubjectSummary> = {};
  for (const c of cards) {
    const lv = levelOf(states[c.id]);
    if (lv === 'new') continue;
    const s = (out[c.s] ??= { l: 0, m: 0 });
    if (lv === 'mature') s.m++;
    else s.l++;
  }
  return out;
}
