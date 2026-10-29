import { normalize, randomId, recount, tidy } from './importer';
import type { CardData, Catalog, ChunkDoc, SubjectMeta } from './types';

/** 管理画面での編集結果（Firestore に書き込む内容） */
export interface EditPlan {
  catalog: Catalog;
  /** 書き込むチャンク（全体を上書き） */
  write: Record<string, ChunkDoc>;
  /** 空になったので削除するチャンク */
  remove: string[];
  /** 変わったカードの枚数 */
  changed: number;
}

const same = (a: string, b: string) => normalize(a) === normalize(b);

function cloneSubjects(catalog: Catalog): SubjectMeta[] {
  return catalog.subjects.map((s) => ({ ...s, units: s.units.map((u) => ({ ...u })) }));
}

/**
 * カードを書き換える共通処理。
 * mutate が null を返したカードは削除、undefined はそのまま、カードを返したら置き換える。
 * カードの ID とチャンクは変えないので、学習記録はそのまま引き継がれる。
 */
function editCards(
  subjects: SubjectMeta[],
  chunks: Record<string, ChunkDoc>,
  mutate: (c: CardData) => CardData | null | undefined,
): EditPlan {
  const work: Record<string, ChunkDoc> = {};
  const write: Record<string, ChunkDoc> = {};
  const remove: string[] = [];
  let changed = 0;
  for (const [id, ch] of Object.entries(chunks)) {
    let dirty = false;
    const next: CardData[] = [];
    for (const c of ch.c) {
      const r = mutate(c);
      if (r === undefined) next.push(c);
      else {
        dirty = true;
        changed++;
        if (r) next.push(r);
      }
    }
    work[id] = { s: ch.s, c: next };
    if (dirty) {
      if (next.length) write[id] = work[id];
      else remove.push(id);
    }
  }
  return { catalog: recount(subjects, work), write, remove, changed };
}

/** カードの区分を整える（空なら持たせない） */
function withSection(c: CardData, section: string | undefined): CardData {
  const out = { ...c };
  if (section) out.c = section;
  else delete out.c;
  return out;
}

export function renameSubject(catalog: Catalog, subject: string, name: string): Catalog {
  const n = tidy(name);
  if (!n) throw new Error('名前を入力してください');
  if (catalog.subjects.some((s) => s.id !== subject && same(s.name, n))) throw new Error(`「${n}」という科目はすでにあります`);
  return { ...catalog, subjects: cloneSubjects(catalog).map((s) => (s.id === subject ? { ...s, name: n } : s)), updatedAt: Date.now() };
}

export function renameSet(catalog: Catalog, subject: string, unit: string, name: string): Catalog {
  const n = tidy(name);
  if (!n) throw new Error('名前を入力してください');
  const subjects = cloneSubjects(catalog);
  const s = subjects.find((x) => x.id === subject);
  if (!s) throw new Error('科目が見つかりません');
  if (s.units.some((u) => u.id !== unit && same(u.name, n))) {
    throw new Error(`「${n}」というセットはすでにあります。まとめるときは「ほかのセットにまとめる」を使ってください`);
  }
  s.units = s.units.map((u) => (u.id === unit ? { ...u, name: n } : u));
  return { ...catalog, subjects, updatedAt: Date.now() };
}

/** セットの並びを1つ上（-1）か下（+1）へ動かす */
export function moveSetOrder(catalog: Catalog, subject: string, unit: string, delta: -1 | 1): Catalog {
  const subjects = cloneSubjects(catalog);
  const s = subjects.find((x) => x.id === subject);
  if (!s) return catalog;
  const i = s.units.findIndex((u) => u.id === unit);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= s.units.length) return catalog;
  [s.units[i], s.units[j]] = [s.units[j], s.units[i]];
  return { ...catalog, subjects, updatedAt: Date.now() };
}

/** 移す先の科目（なければ作る） */
function targetSubject(subjects: SubjectMeta[], target: { subject?: string; newSubject?: string }): SubjectMeta {
  if (target.subject) {
    const s = subjects.find((x) => x.id === target.subject);
    if (!s) throw new Error('移す先の科目が見つかりません');
    return s;
  }
  const name = tidy(target.newSubject ?? '');
  if (!name) throw new Error('新しい科目の名前を入力してください');
  const found = subjects.find((x) => same(x.name, name));
  if (found) return found;
  const s: SubjectMeta = { id: randomId('s', 6), name, count: 0, units: [] };
  subjects.push(s);
  return s;
}

/** セットをほかの科目へ移す */
export function moveSetToSubject(
  catalog: Catalog,
  chunks: Record<string, ChunkDoc>,
  subject: string,
  unit: string,
  target: { subject?: string; newSubject?: string },
): EditPlan {
  const subjects = cloneSubjects(catalog);
  const from = subjects.find((x) => x.id === subject);
  const meta = from?.units.find((u) => u.id === unit);
  if (!from || !meta) throw new Error('セットが見つかりません');
  const to = targetSubject(subjects, target);
  if (to.id === subject) throw new Error('同じ科目です');
  const clash = to.units.find((u) => same(u.name, meta.name));
  const destUnit = clash ? clash.id : unit;
  if (!clash) to.units.push({ ...meta });
  from.units = from.units.filter((u) => u.id !== unit);
  return editCards(subjects, chunks, (c) => (c.s === subject && c.u === unit ? { ...c, s: to.id, u: destUnit } : undefined));
}

/**
 * セットをほかのセットにまとめる。
 * 区分のないカードには元のセット名を区分として付け、まとめたあとも絞り込めるようにする。
 */
export function mergeSet(
  catalog: Catalog,
  chunks: Record<string, ChunkDoc>,
  from: { subject: string; unit: string },
  to: { subject: string; unit: string },
): EditPlan {
  if (from.subject === to.subject && from.unit === to.unit) throw new Error('同じセットです');
  const subjects = cloneSubjects(catalog);
  const fromName = subjects.find((s) => s.id === from.subject)?.units.find((u) => u.id === from.unit)?.name;
  const toMeta = subjects.find((s) => s.id === to.subject)?.units.find((u) => u.id === to.unit);
  if (!fromName || !toMeta) throw new Error('セットが見つかりません');
  return editCards(subjects, chunks, (c) =>
    c.s === from.subject && c.u === from.unit ? withSection({ ...c, s: to.subject, u: to.unit }, c.c || fromName) : undefined,
  );
}

/** 区分の名前を変える。複数の区分を同じ名前にすれば1つにまとまる。空の名前なら区分をなくす */
export function renameSections(
  catalog: Catalog,
  chunks: Record<string, ChunkDoc>,
  subject: string,
  unit: string,
  sections: string[],
  name: string,
): EditPlan {
  const n = tidy(name);
  return editCards(cloneSubjects(catalog), chunks, (c) =>
    c.s === subject && c.u === unit && sections.includes(c.c ?? '') && (c.c ?? '') !== n ? withSection(c, n) : undefined,
  );
}

/** 区分を、ほかのセット（または新しいセット）へ移す。区分の名前はそのまま */
export function moveSections(
  catalog: Catalog,
  chunks: Record<string, ChunkDoc>,
  subject: string,
  unit: string,
  sections: string[],
  target: { unit?: string; newUnit?: string },
): EditPlan {
  const subjects = cloneSubjects(catalog);
  const s = subjects.find((x) => x.id === subject);
  if (!s) throw new Error('科目が見つかりません');
  let dest = target.unit;
  if (!dest) {
    const name = tidy(target.newUnit ?? '');
    if (!name) throw new Error('新しいセットの名前を入力してください');
    const found = s.units.find((u) => same(u.name, name));
    if (found) dest = found.id;
    else {
      dest = randomId('u', 6);
      s.units.push({ id: dest, name, count: 0 });
    }
  }
  if (dest === unit) throw new Error('同じセットです');
  const to = dest;
  return editCards(subjects, chunks, (c) => (c.s === subject && c.u === unit && sections.includes(c.c ?? '') ? { ...c, u: to } : undefined));
}

/** セットをカードごと削除する */
export function deleteSet(catalog: Catalog, chunks: Record<string, ChunkDoc>, subject: string, unit: string): EditPlan {
  return editCards(cloneSubjects(catalog), chunks, (c) => (c.s === subject && c.u === unit ? null : undefined));
}

export function deleteCard(catalog: Catalog, chunks: Record<string, ChunkDoc>, id: string): EditPlan {
  return editCards(cloneSubjects(catalog), chunks, (c) => (c.id === id ? null : undefined));
}
