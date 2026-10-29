import { deleteField, doc, increment, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import type { DayAct, SavedState, SubjectSummary } from './types';

/** この枚数ごと、または最後の回答からこの時間がたったらまとめて保存する（書き込み回数の節約） */
const FLUSH_EVERY = 5;
const FLUSH_DELAY_MS = 20_000;

type ActDelta = Record<string, DayAct>;

function addAct(target: ActDelta, day: string, d: DayAct) {
  const cur = target[day] ?? { n: 0, a: 0, nw: 0 };
  target[day] = { n: cur.n + d.n, a: cur.a + d.a, nw: cur.nw + d.nw };
}

/**
 * 回答結果を手元に反映し、まとめて Firestore に保存する。
 * overlay はこのセッションで変更したカードの最新状態（null は「未学習に戻した」）。
 */
export class Syncer {
  overlay: Record<string, SavedState | null> = {};
  private dirty = new Set<string>();
  /** 未送信の学習記録 */
  private pendingAct: ActDelta = {};
  /** 送信したが、まだ利用者ドキュメントの更新通知に反映されていない学習記録 */
  private inflightAct: ActDelta = {};
  private count = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  version = 0;
  error: string | null = null;

  constructor(
    private uid: string,
    private chunkOf: (cardId: string) => string | undefined,
    private summary: () => Record<string, SubjectSummary>,
  ) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  record(cardId: string, next: SavedState | null, day: string, delta: DayAct) {
    this.overlay[cardId] = next;
    this.dirty.add(cardId);
    addAct(this.pendingAct, day, delta);
    this.count++;
    this.emit();
    clearTimeout(this.timer);
    if (this.count >= FLUSH_EVERY) this.flush();
    else this.timer = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
  }

  /** 利用者ドキュメントの更新通知が届いたら呼ぶ */
  onUserDocSnapshot() {
    if (Object.keys(this.inflightAct).length) {
      this.inflightAct = {};
      this.emit();
    }
  }

  /** 保存済みの記録に、まだ反映されていない分を足したもの */
  mergeAct(base: Record<string, DayAct> | undefined): Record<string, DayAct> {
    const out: ActDelta = { ...(base ?? {}) };
    for (const src of [this.inflightAct, this.pendingAct]) for (const [day, d] of Object.entries(src)) addAct(out, day, d);
    return out;
  }

  flush() {
    clearTimeout(this.timer);
    if (!this.dirty.size && !Object.keys(this.pendingAct).length) return;
    const batch = writeBatch(db);
    const byChunk: Record<string, Record<string, unknown>> = {};
    for (const id of this.dirty) {
      const chunk = this.chunkOf(id);
      if (!chunk) continue;
      const v = this.overlay[id];
      (byChunk[chunk] ??= {})[id] = v === null ? deleteField() : v;
    }
    for (const [chunk, c] of Object.entries(byChunk)) {
      batch.set(doc(db, 'users', this.uid, 'states', chunk), { c }, { merge: true });
    }
    const act: Record<string, unknown> = {};
    let total = 0;
    for (const [day, d] of Object.entries(this.pendingAct)) {
      act[day] = { n: increment(d.n), a: increment(d.a), nw: increment(d.nw) };
      total += d.n;
    }
    batch.set(
      doc(db, 'users', this.uid),
      { act, sum: { last: Date.now(), total: increment(total), subj: this.summary() } },
      { merge: true },
    );
    for (const [day, d] of Object.entries(this.pendingAct)) addAct(this.inflightAct, day, d);
    this.pendingAct = {};
    this.dirty.clear();
    this.count = 0;
    // オフラインのときは端末に保存され、電波が戻ったときに送信される
    batch.commit().catch((e: Error) => {
      this.error = e.message;
      this.emit();
    });
  }
}
