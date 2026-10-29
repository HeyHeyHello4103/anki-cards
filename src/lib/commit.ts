import { doc, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import type { Catalog, ChunkDoc } from './types';

/**
 * カードのチャンクと科目一覧を書き込む。
 * Firestore の1回の書き込みは10MiBまでなので、大きいときは分けて送る。科目一覧は最後に更新する。
 */
export async function commitPlan(plan: { catalog: Catalog; write: Record<string, ChunkDoc>; remove: string[] }) {
  const enc = new TextEncoder();
  const ops: { size: number; apply: (b: ReturnType<typeof writeBatch>) => void }[] = [];
  for (const [id, chunk] of Object.entries(plan.write)) {
    ops.push({ size: enc.encode(JSON.stringify(chunk)).length, apply: (b) => b.set(doc(db, 'cards', id), chunk) });
  }
  for (const id of plan.remove) ops.push({ size: 100, apply: (b) => b.delete(doc(db, 'cards', id)) });
  ops.push({ size: 50_000, apply: (b) => b.set(doc(db, 'catalog', 'main'), plan.catalog) });
  let batch = writeBatch(db);
  let size = 0;
  let count = 0;
  for (const op of ops) {
    if (count > 0 && (size + op.size > 6_000_000 || count >= 400)) {
      await batch.commit();
      batch = writeBatch(db);
      size = 0;
      count = 0;
    }
    op.apply(batch);
    size += op.size;
    count++;
  }
  await batch.commit();
}
