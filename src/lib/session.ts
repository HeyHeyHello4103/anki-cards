import { nextStudyDayStart, studyDayStart } from './dates';
import { levelOf, State } from './scheduler';
import type { CardData, SavedState, SubjectSummary } from './types';

export type Scope =
  | { kind: 'all' }
  | { kind: 'subject'; subject: string }
  | { kind: 'units'; subject: string; units: string[] }
  | { kind: 'weak' };

export function inScope(card: CardData, scope: Scope): boolean {
  switch (scope.kind) {
    case 'all':
    case 'weak':
      return true;
    case 'subject':
      return card.s === scope.subject;
    case 'units':
      return card.s === scope.subject && scope.units.includes(card.u);
  }
}

/** 今日すでに新しく学習したカードの数 */
export function newStudiedToday(states: Record<string, SavedState>, now: number): number {
  const start = studyDayStart(now);
  let n = 0;
  for (const s of Object.values(states)) if (s.fr >= start) n++;
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
  for (const c of cards) {
    const s = states[c.id];
    if (s && s.st !== State.New && s.due < end) (isLearning(s) ? learn : review).push({ id: c.id, due: s.due });
  }
  const fresh = pickFresh(cards, states, newLeft);
  learn.sort((a, b) => a.due - b.due);
  review.sort((a, b) => a.due - b.due);
  return { learn: learn.map((x) => x.id), main: interleave(review.map((x) => x.id), fresh, 4), freshCount: fresh.length };
}

/**
 * 新規カードを、科目ごと・単元ごとに1枚ずつ順番に回して選ぶ。
 * 並び順のまま選ぶと、最初の単元を全部終えるまでほかの単元の新規カードが出てこないため。
 */
export function pickFresh(cards: CardData[], states: Record<string, SavedState>, limit: number): string[] {
  const subjects = new Map<string, Map<string, string[]>>();
  for (const c of cards) {
    const s = states[c.id];
    if (s && s.st !== State.New) continue;
    let units = subjects.get(c.s);
    if (!units) subjects.set(c.s, (units = new Map()));
    let list = units.get(c.u);
    if (!list) units.set(c.u, (list = []));
    list.push(c.id);
  }
  const rings = [...subjects.values()].map((units) => ({ lists: [...units.values()].map((ids) => ({ ids, pos: 0 })), turn: 0 }));
  const out: string[] = [];
  while (out.length < limit && rings.length) {
    for (let i = 0; i < rings.length && out.length < limit; ) {
      const ring = rings[i];
      const k = ring.turn % ring.lists.length;
      const list = ring.lists[k];
      out.push(list.ids[list.pos++]);
      if (list.pos >= list.ids.length) {
        ring.lists.splice(k, 1);
        ring.turn = k;
      } else ring.turn = k + 1;
      if (ring.lists.length) i++;
      else rings.splice(i, 1);
    }
  }
  return out;
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
