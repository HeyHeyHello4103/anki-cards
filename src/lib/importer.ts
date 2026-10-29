import { checkMath } from './render';
import type { CardData, Catalog, ChunkDoc, SubjectMeta } from './types';

export type Field = 'id' | 'subject' | 'unit' | 'section' | 'front' | 'back' | 'note' | 'tags';

const HEADER_ALIASES: Record<Field, string[]> = {
  id: ['id', 'カードid'],
  subject: ['科目', '教科', 'subject'],
  unit: ['セット', '単元', '章', '分野', 'デッキ', 'set', 'unit', 'deck', 'chapter'],
  section: ['区分', '小分類', 'セクション', 'section'],
  front: ['表', '表面', 'おもて', '問題', '問', '質問', 'front', 'question'],
  back: ['裏', '裏面', 'うら', '答え', '答', '解答', '正解', 'back', 'answer'],
  note: ['解説', '補足', 'メモ', '備考', 'note', 'notes', 'explanation'],
  tags: ['タグ', 'tag', 'tags'],
};

export const CSV_HEADER = ['ID', '科目', 'セット', '区分', '表', '裏', '解説', 'タグ'];

/** 表記ゆれを吸収するための正規化（全角半角・空白の違いを無視） */
export function normalize(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

const looseKey = (s: string) => normalize(s).replace(/ /g, '').toLowerCase();

/** 表示用：空白だけ整える（全角記号などはそのまま残す） */
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

export interface ImportRow {
  /** ファイル上の行番号（見出し行が1） */
  line: number;
  id: string;
  subject: string;
  unit: string;
  /** 区分（空ならなし） */
  section: string;
  front: string;
  back: string;
  note: string;
  tags: string[];
}

export interface ParsedFile {
  rows: ImportRow[];
  columns: Partial<Record<Field, number>>;
  missingColumns: Field[];
}

const HTML_TAG = /<(br|div|p|span|b|i|u|font|strong|em|sub|sup)\b[^>]*>/i;

/** Anki などから書き出したHTML入りの文字列を、改行付きのテキストにする */
export function htmlToText(s: string): string {
  if (!HTML_TAG.test(s)) return s;
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p)>/gi, '\n')
    .replace(/<(b|strong)\b[^>]*>(.*?)<\/\1>/gi, '**$2**')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function readRows(table: string[][], defaults: { subject: string; unit: string }): ParsedFile {
  const header = table[0] ?? [];
  const columns: Partial<Record<Field, number>> = {};
  header.forEach((h, idx) => {
    const key = looseKey(h);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [Field, string[]][]) {
      if (columns[field] === undefined && aliases.includes(key)) columns[field] = idx;
    }
  });
  const missingColumns = (['front', 'back'] as Field[]).filter((f) => columns[f] === undefined);
  if (columns.subject === undefined && !tidy(defaults.subject)) missingColumns.push('subject');

  const cell = (r: string[], f: Field) => {
    const idx = columns[f];
    return idx === undefined ? '' : htmlToText(r[idx] ?? '');
  };
  const rows: ImportRow[] = table.slice(1).map((r, i) => ({
    line: i + 2,
    id: cell(r, 'id').trim(),
    subject: tidy(cell(r, 'subject')) || tidy(defaults.subject),
    unit: tidy(cell(r, 'unit')) || tidy(defaults.unit) || '全般',
    section: tidy(cell(r, 'section')),
    front: cell(r, 'front').trim(),
    back: cell(r, 'back').trim(),
    note: cell(r, 'note').trim(),
    tags: tidy(cell(r, 'tags')).split(' ').filter(Boolean),
  }));
  return { rows, columns, missingColumns };
}

export interface Issue {
  level: 'error' | 'warn';
  kind: string;
  lines: number[];
  message: string;
}

/** 答えがこれより長いカードは「長すぎる」と知らせる */
export const LONG_ANSWER = 200;

/**
 * 取り込み前の点検。
 * error があれば取り込まない。warn は確認を促すだけ。
 */
export function validateRows(rows: ImportRow[], existing: Map<string, { card: CardData; subjectName: string }>): Issue[] {
  const issues: Issue[] = [];
  const add = (level: Issue['level'], kind: string, lines: number[], message: string) =>
    issues.push({ level, kind, lines, message });

  const idLines = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.subject) add('error', '空欄', [r.line], '科目が空欄です');
    if (!r.front) add('error', '空欄', [r.line], '表（問題）が空欄です');
    if (!r.back) add('error', '空欄', [r.line], '裏（答え）が空欄です');
    if (r.id) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(r.id)) add('error', 'ID', [r.line], `IDに使えない文字があります: ${r.id}`);
      idLines.set(r.id, [...(idLines.get(r.id) ?? []), r.line]);
    }
    if (r.front && r.back && normalize(r.front) === normalize(r.back))
      add('warn', '表と裏が同じ', [r.line], '表と裏が同じ内容です');
    if (r.back.length > LONG_ANSWER)
      add('warn', '答えが長い', [r.line], `答えが${r.back.length}文字あります。暗記カードとしては長いので、分割を検討してください`);
    for (const [label, text] of [['表', r.front], ['裏', r.back], ['解説', r.note]] as const) {
      for (const msg of checkMath(text)) add('warn', '数式', [r.line], `${label}: ${msg}`);
    }
  }
  for (const [id, lines] of idLines) {
    if (lines.length > 1) add('error', 'ID重複', lines, `同じID「${id}」が複数の行にあります`);
  }

  // 取り込み後のカード全体（ファイルにない既存カードも含む）で、問題文の重複と表記ゆれを調べる
  type Entry = { line: number | null; subject: string; front: string; back: string };
  const entries: Entry[] = rows.map((r) => ({ line: r.line, subject: r.subject, front: r.front, back: r.back }));
  const inFile = new Set(rows.map((r) => r.id).filter(Boolean));
  for (const [id, { card, subjectName }] of existing) {
    if (!inFile.has(id)) entries.push({ line: null, subject: subjectName, front: card.f, back: card.b });
  }
  const byFront = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!e.front) continue;
    const key = looseKey(e.subject) + '\u0000' + looseKey(e.front);
    byFront.set(key, [...(byFront.get(key) ?? []), e]);
  }
  for (const group of byFront.values()) {
    if (group.length < 2 || group.every((e) => e.line === null)) continue;
    const lines = group.map((e) => e.line).filter((l): l is number => l !== null);
    const where = group.some((e) => e.line === null) ? '（登録済みのカードを含む）' : '';
    const backs = new Set(group.map((e) => looseKey(e.back)));
    if (backs.size > 1) {
      add('warn', '答えが一つに定まらない', lines,
        `同じ問題なのに答えが違うカードがあります${where}: 「${group[0].front.slice(0, 30)}」→ ${[...new Set(group.map((e) => e.back.slice(0, 20)))].join(' / ')}`);
    } else {
      add('warn', '重複', lines, `同じ問題と答えのカードが${group.length}枚あります${where}: 「${group[0].front.slice(0, 30)}」`);
    }
    const raws = new Set(group.map((e) => e.front));
    if (raws.size > 1)
      add('warn', '表記ゆれ', lines, `全角・半角や空白だけが違う問題文があります: ${[...raws].map((s) => `「${s.slice(0, 20)}」`).join(' ')}`);
  }

  // 科目名・単元名の表記ゆれ（別の科目・単元として登録されてしまう）
  const nameGroups = (names: string[]) => {
    const m = new Map<string, Set<string>>();
    for (const n of names) {
      const k = looseKey(n);
      m.set(k, (m.get(k) ?? new Set()).add(n));
    }
    return [...m.values()].filter((s) => s.size > 1);
  };
  for (const g of nameGroups(rows.map((r) => r.subject)))
    add('warn', '表記ゆれ', [], `科目名の表記が揺れています: ${[...g].map((s) => `「${s}」`).join(' ')}`);
  for (const g of nameGroups(rows.map((r) => `${r.subject} / ${r.unit}`)))
    add('warn', '表記ゆれ', [], `セット名の表記が揺れています: ${[...g].map((s) => `「${s}」`).join(' ')}`);

  // 要修正を先に、あとは行番号の順に並べる
  const first = (i: Issue) => (i.lines.length ? Math.min(...i.lines) : Number.MAX_SAFE_INTEGER);
  return issues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1) || first(a) - first(b));
}

/** 1つのチャンク（Firestore の1ドキュメント）に入れるカードの上限 */
export const MAX_CARDS_PER_CHUNK = 800;
export const MAX_CHUNK_BYTES = 600_000;

const enc = new TextEncoder();
const byteSize = (v: unknown) => enc.encode(JSON.stringify(v)).length;

export function randomId(prefix = '', len = 8): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return prefix + Array.from(bytes, (b) => alphabet[b % 36]).join('');
}

export interface ImportPlan {
  catalog: Catalog;
  /** 書き込むチャンク（全体を上書き） */
  write: Record<string, ChunkDoc>;
  /** 空になったので削除するチャンク */
  remove: string[];
  added: number;
  updated: number;
  unchanged: number;
  deleted: number;
}

const sameCard = (a: CardData, b: CardData) =>
  a.s === b.s && a.u === b.u && (a.c ?? '') === (b.c ?? '') && a.f === b.f && a.b === b.b && (a.n ?? '') === (b.n ?? '') &&
  (a.t ?? []).join(' ') === (b.t ?? []).join(' ');

function cleanCard(c: CardData): CardData {
  const out: CardData = { id: c.id, s: c.s, u: c.u, f: c.f, b: c.b };
  if (c.c) out.c = c.c;
  if (c.n) out.n = c.n;
  if (c.t && c.t.length) out.t = c.t;
  return out;
}

/** 取り込み内容から、Firestore に書き込む内容を計算する（書き込みはしない） */
export function planImport(
  rows: ImportRow[],
  catalog: Catalog | null,
  chunks: Record<string, ChunkDoc>,
  opts: { deleteMissing: boolean },
): ImportPlan {
  // 既存の科目・単元を名前で引けるようにする
  const subjects: SubjectMeta[] = (catalog?.subjects ?? []).map((s) => ({ ...s, units: s.units.map((u) => ({ ...u })) }));
  const subjectByName = new Map(subjects.map((s) => [looseKey(s.name), s]));
  const usedIds = new Set<string>();
  const resolve = (subjectName: string, unitName: string) => {
    let s = subjectByName.get(looseKey(subjectName));
    if (!s) {
      s = { id: randomId('s', 6), name: subjectName, count: 0, units: [] };
      subjects.push(s);
      subjectByName.set(looseKey(subjectName), s);
    }
    let u = s.units.find((x) => looseKey(x.name) === looseKey(unitName));
    if (!u) {
      u = { id: randomId('u', 6), name: unitName, count: 0 };
      s.units.push(u);
    }
    return { s: s.id, u: u.id };
  };

  const work: Record<string, ChunkDoc> = {};
  for (const [id, ch] of Object.entries(chunks)) work[id] = { s: ch.s, c: ch.c.map((c) => ({ ...c })) };
  const where = new Map<string, { chunk: string; index: number }>();
  for (const [id, ch] of Object.entries(work)) ch.c.forEach((c, index) => where.set(c.id, { chunk: id, index }));
  for (const id of where.keys()) usedIds.add(id);

  const dirty = new Set<string>();
  const seen = new Set<string>();
  const fresh = new Map<string, CardData[]>();
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const r of rows) {
    const { s, u } = resolve(r.subject, r.unit);
    const next: CardData = cleanCard({ id: r.id, s, u, c: r.section, f: r.front, b: r.back, n: r.note, t: r.tags });
    const loc = r.id ? where.get(r.id) : undefined;
    if (loc) {
      seen.add(r.id);
      const ch = work[loc.chunk];
      if (sameCard(ch.c[loc.index], next)) unchanged++;
      else {
        ch.c[loc.index] = next;
        dirty.add(loc.chunk);
        updated++;
      }
      continue;
    }
    let id = r.id;
    if (!id || usedIds.has(id)) {
      do id = randomId(); while (usedIds.has(id));
    }
    usedIds.add(id);
    seen.add(id);
    fresh.set(s, [...(fresh.get(s) ?? []), { ...next, id }]);
    added++;
  }

  let deleted = 0;
  if (opts.deleteMissing) {
    for (const [id, ch] of Object.entries(work)) {
      const kept = ch.c.filter((c) => seen.has(c.id));
      if (kept.length !== ch.c.length) {
        deleted += ch.c.length - kept.length;
        ch.c = kept;
        dirty.add(id);
      }
    }
  }

  // 新しいカードは、同じ科目の最後のチャンクに空きがあればそこへ、なければ新しいチャンクへ
  for (const [sid, list] of fresh) {
    const own = Object.keys(work).filter((id) => work[id].s === sid).sort();
    let target: string | undefined = own[own.length - 1];
    let size = target ? byteSize(work[target]) : 0;
    let seq = own.length ? Math.max(...own.map((id) => Number(id.split('-').pop()) || 0)) : 0;
    for (const card of list) {
      const cardSize = byteSize(card) + 1;
      if (!target || work[target].c.length >= MAX_CARDS_PER_CHUNK || size + cardSize > MAX_CHUNK_BYTES) {
        seq++;
        target = `${sid}-${String(seq).padStart(3, '0')}`;
        work[target] = { s: sid, c: [] };
        size = byteSize(work[target]);
      }
      work[target].c.push(card);
      size += cardSize;
      dirty.add(target);
    }
  }

  // 件数を数え直し、空になった科目・単元は消す
  const counts = new Map<string, number>();
  for (const ch of Object.values(work))
    for (const c of ch.c) {
      counts.set(c.s, (counts.get(c.s) ?? 0) + 1);
      counts.set(c.s + '/' + c.u, (counts.get(c.s + '/' + c.u) ?? 0) + 1);
    }
  // 並び順はファイルに出てきた順にそろえる（ファイルにない科目・セットはその後ろに元の順で残す）
  const fileOrder = new Map<string, number>();
  for (const r of rows) {
    const { s, u } = resolve(r.subject, r.unit);
    if (!fileOrder.has(s)) fileOrder.set(s, fileOrder.size);
    if (!fileOrder.has(s + '/' + u)) fileOrder.set(s + '/' + u, fileOrder.size);
  }
  const byFile = <T,>(items: T[], key: (x: T) => string) =>
    items
      .map((x, i) => ({ x, rank: fileOrder.get(key(x)) ?? rows.length * 2 + i }))
      .sort((a, b) => a.rank - b.rank)
      .map((v) => v.x);
  const outSubjects = byFile(subjects, (s) => s.id)
    .map((s) => ({
      ...s,
      count: counts.get(s.id) ?? 0,
      units: byFile(s.units, (u) => s.id + '/' + u.id)
        .map((u) => ({ ...u, count: counts.get(s.id + '/' + u.id) ?? 0 }))
        .filter((u) => u.count > 0),
    }))
    .filter((s) => s.count > 0);

  const write: Record<string, ChunkDoc> = {};
  const remove: string[] = [];
  for (const id of dirty) {
    if (work[id].c.length) write[id] = work[id];
    else if (chunks[id]) remove.push(id);
  }
  return {
    catalog: { subjects: outSubjects, total: outSubjects.reduce((n, s) => n + s.count, 0), updatedAt: Date.now() },
    write,
    remove,
    added,
    updated,
    unchanged,
    deleted,
  };
}

/** 登録済みカードを、そのまま取り込み直せる形の表にする */
export function exportRows(catalog: Catalog | null, cards: CardData[]): string[][] {
  const names = new Map<string, string>();
  for (const s of catalog?.subjects ?? []) {
    names.set(s.id, s.name);
    for (const u of s.units) names.set(s.id + '/' + u.id, u.name);
  }
  return [
    CSV_HEADER,
    ...cards.map((c) => [c.id, names.get(c.s) ?? '', names.get(c.s + '/' + c.u) ?? '', c.c ?? '', c.f, c.b, c.n ?? '', (c.t ?? []).join(' ')]),
  ];
}

export const TEMPLATE_ROWS: string[][] = [
  CSV_HEADER,
  ['', '数学', '数学Ⅰ 公式', '二次関数', '$y=x^2-4x+3$ の頂点の座標は？', '$(2,\\,-1)$', '$y=(x-2)^2-1$ と平方完成する', ''],
  ['', '化学', '化学反応式', '燃焼', 'メタン $\\ce{CH4}$ が完全燃焼するときの化学反応式は？', '$\\ce{CH4 + 2O2 -> CO2 + 2H2O}$', '', ''],
  ['', '日本史', '日本史 一問一答', '鎌倉時代', '1221年、後鳥羽上皇が鎌倉幕府を倒そうとして起こした戦いは？', '承久の乱', '', '頻出'],
  ['', '英語', '英単語', '', 'abandon', '（動）〜を捨てる、放棄する', '', ''],
];
