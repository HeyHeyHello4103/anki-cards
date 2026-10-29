import { describe, expect, it } from 'vitest';
import { decodeText, parseDelimited, toCsv } from '../src/lib/csv';
import { addDays, dayKey, daysUntil, studyDayStart } from '../src/lib/dates';
import {
  exportRows,
  htmlToText,
  MAX_CARDS_PER_CHUNK,
  planImport,
  readRows,
  TEMPLATE_ROWS,
  validateRows,
  type ImportRow,
} from '../src/lib/importer';
import { deleteCard, deleteSet, mergeSet, moveSections, moveSetOrder, moveSetToSubject, renameSections, renameSet } from '../src/lib/edit';
import { parseProgressFile, planProgressImport } from '../src/lib/progress';
import { checkMath, plainText, renderRich, tokenize } from '../src/lib/render';
import { levelOf, makeScheduler, maxIntervalFor, previewNext, Rating, State } from '../src/lib/scheduler';
import { buildQueue, byImp, countDue, forecast, impOf, inScope, interleave, isUsed, newLimitFor, newStudiedToday, pickNext, sectionsOf, unitKey } from '../src/lib/session';
import type { CardData, ChunkDoc, SavedState } from '../src/lib/types';

const at = (s: string) => new Date(s).getTime();

describe('csv', () => {
  it('引用符・セル内改行・"" を扱える', () => {
    const rows = parseDelimited('科目,表,裏\r\n数学,"1行目\n2行目","a,""b"""\r\n\r\n');
    expect(rows).toEqual([
      ['科目', '表', '裏'],
      ['数学', '1行目\n2行目', 'a,"b"'],
    ]);
  });
  it('1行目にタブがあればTSVとして読む', () => {
    expect(parseDelimited('表\t裏\nx,y\tz')).toEqual([
      ['表', '裏'],
      ['x,y', 'z'],
    ]);
  });
  it('書き出したCSVを読み直すと元に戻る', () => {
    const rows = [
      ['ID', '表'],
      ['a', '改行\nと "引用符" と,カンマ'],
      ['b', ' 前後の空白 '],
    ];
    expect(parseDelimited(toCsv(rows))).toEqual(rows);
  });
  it('BOM付きUTF-8とShift_JISを読める', () => {
    const utf8 = new TextEncoder().encode('﻿科目');
    expect(decodeText(utf8.buffer as ArrayBuffer)).toBe('科目');
    const sjis = new Uint8Array([0x89, 0xc8, 0x96, 0xda]); // 「科目」
    expect(decodeText(sjis.buffer)).toBe('科目');
  });
});

describe('dates', () => {
  it('午前4時より前は前日として数える', () => {
    expect(dayKey(at('2026-10-29T03:59:00'))).toBe('2026-10-28');
    expect(dayKey(at('2026-10-29T04:00:00'))).toBe('2026-10-29');
    expect(studyDayStart(at('2026-10-29T02:00:00'))).toBe(at('2026-10-28T04:00:00'));
  });
  it('日数の計算', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(daysUntil('2027-01-16', at('2026-10-29T12:00:00'))).toBe(79);
  });
});

describe('render', () => {
  it('数式・化学式・エスケープを区別する', () => {
    const t = tokenize('値段は\\$100、$x^2$ と $$\\int f$$ と \\ce{H2O}');
    expect(t.unclosed).toBe(false);
    expect(t.segments.map((s) => s.kind)).toEqual(['text', 'math', 'text', 'math', 'text', 'math']);
    expect(t.segments[0]).toEqual({ kind: 'text', text: '値段は$100、' });
    expect(t.segments[5]).toEqual({ kind: 'math', tex: '\\ce{H2O}', display: false });
  });
  it('HTMLを無害化し、太字と改行を表示する', () => {
    const html = renderRich('<script>alert(1)</script>\n**重要**');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<br><strong>重要</strong>');
  });
  it('数式の誤りを見つける', () => {
    expect(checkMath('$x^2$ と $\\ce{CH4 + 2O2 -> CO2 + 2H2O}$')).toEqual([]);
    expect(checkMath('$\\frac{1}{$')).toHaveLength(1);
    expect(checkMath('料金は$100')).toHaveLength(1);
  });
  it('一覧用の短い文字列', () => {
    expect(plainText('**あ**\n$x$', 10)).toBe('あ x');
  });
});

describe('importer', () => {
  const table = (rows: string[][]) => readRows(rows, { subject: '', unit: '' });

  it('見出しの別名を認識し、HTMLをテキストにする', () => {
    const p = table([
      ['問題', '答え', '教科', '章'],
      ['Q<br>2行目', '<b>A</b>&nbsp;です', '数学', '1章'],
    ]);
    expect(p.missingColumns).toEqual([]);
    expect(p.rows[0]).toMatchObject({ line: 2, subject: '数学', unit: '1章', front: 'Q\n2行目', back: '**A** です' });
  });
  it('表・裏の列がなければ知らせる', () => {
    expect(table([['科目', 'question']]).missingColumns).toEqual(['back']);
  });
  it('科目名・単元名の全角記号はそのまま残す', () => {
    const p = table([['科目', '単元', '表', '裏'], ['英語', '熟語：動詞句（頻出）', 'a', 'b']]);
    expect(p.rows[0].unit).toBe('熟語：動詞句（頻出）');
  });
  it('科目の列がないときは入力した科目名を使う', () => {
    const p = readRows([['表', '裏'], ['a', 'b']], { subject: '英語', unit: '' });
    expect(p.rows[0]).toMatchObject({ subject: '英語', unit: '全般' });
  });
  it('テンプレートは点検で問題が出ない', () => {
    const p = table(TEMPLATE_ROWS);
    expect(validateRows(p.rows, new Map())).toEqual([]);
  });

  const row = (line: number, front: string, back: string, extra: Partial<ImportRow> = {}): ImportRow => ({
    line,
    id: '',
    subject: '化学',
    unit: '無機',
    section: '',
    front,
    back,
    note: '',
    tags: [],
    ...extra,
  });

  it('答えが一つに定まらない・重複・表記ゆれ・空欄・ID重複・長すぎる答えを見つける', () => {
    const issues = validateRows(
      [
        row(2, '二酸化炭素の化学式は？', 'CO2'),
        row(3, '二酸化炭素の化学式は？', 'CO₂ではなくCO'),
        row(4, '水の化学式は？', 'H2O'),
        row(5, '水の化学式は？', 'H2O'),
        row(6, 'ＣＯ２の名前は？', '二酸化炭素'),
        row(7, 'CO2の名前は？', '二酸化炭素'),
        row(8, '', 'x'),
        row(9, 'a', 'b', { id: 'dup' }),
        row(10, 'c', 'd', { id: 'dup' }),
        row(11, '長い', 'あ'.repeat(201)),
      ],
      new Map(),
    );
    const kinds = issues.map((i) => `${i.level}:${i.kind}:${i.lines.join(',')}`);
    expect(kinds).toContain('warn:答えが一つに定まらない:2,3');
    expect(kinds).toContain('warn:重複:4,5');
    expect(kinds).toContain('warn:表記ゆれ:6,7');
    expect(kinds).toContain('error:空欄:8');
    expect(kinds).toContain('error:ID重複:9,10');
    expect(kinds).toContain('warn:答えが長い:11');
  });
  it('登録済みカードとの食い違いも見つける', () => {
    const existing = new Map([
      ['old1', { card: { id: 'old1', s: 's1', u: 'u1', f: '鎌倉幕府の初代将軍は？', b: '源頼朝' }, subjectName: '日本史' }],
    ]);
    const issues = validateRows([row(2, '鎌倉幕府の初代将軍は？', '源義経', { subject: '日本史' })], existing);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('答えが一つに定まらない');
    expect(issues[0].message).toContain('登録済み');
  });

  it('新規取り込み・IDでの更新・削除', () => {
    const first = planImport(
      [row(2, 'a', '1', { subject: '数学', unit: '1章' }), row(3, 'b', '2', { subject: '数学', unit: '2章' }), row(4, 'c', '3')],
      null,
      {},
      { deleteMissing: false },
    );
    expect(first.added).toBe(3);
    expect(first.catalog.total).toBe(3);
    expect(first.catalog.subjects.map((s) => [s.name, s.count, s.units.map((u) => u.name)])).toEqual([
      ['数学', 2, ['1章', '2章']],
      ['化学', 1, ['無機']],
    ]);
    const chunkIds = Object.keys(first.write);
    expect(chunkIds).toHaveLength(2);
    const cards = Object.values(first.write).flatMap((c) => c.c);

    // 書き出したCSVを直して取り込み直す
    const exported = exportRows(first.catalog, cards);
    expect(exported[0]).toEqual(['ID', '科目', 'セット', '区分', '表', '裏', '解説', 'タグ']);
    exported[1][5] = '1（修正）';
    const rows2 = table(exported).rows.slice(0, 2);
    const second = planImport(rows2, first.catalog, first.write, { deleteMissing: true });
    expect([second.added, second.updated, second.unchanged, second.deleted]).toEqual([0, 1, 1, 1]);
    expect(second.catalog.subjects.map((s) => s.name)).toEqual(['数学']);
    expect(second.remove).toHaveLength(1);
    const fixed = Object.values(second.write).flatMap((c) => c.c).find((c) => c.f === 'a');
    expect(fixed?.b).toBe('1（修正）');
    expect(fixed?.id).toBe(cards.find((c) => c.f === 'a')?.id);
  });
  it('区分を取り込み・書き出しでき、セット名の変更でカードは移るがIDは変わらない', () => {
    const p = table([
      ['セット', '区分', '科目', '表', '裏'],
      ['地理 重要事項', '第1問', '地理', 'q1', 'a1'],
      ['地理 重要事項', '第2問', '地理', 'q2', 'a2'],
    ]);
    expect(p.rows.map((r) => r.section)).toEqual(['第1問', '第2問']);
    const first = planImport(p.rows, null, {}, { deleteMissing: false });
    const cards = Object.values(first.write).flatMap((c) => c.c);
    expect(cards.map((c) => c.c)).toEqual(['第1問', '第2問']);
    const exported = exportRows(first.catalog, cards);
    expect(exported[1].slice(1, 4)).toEqual(['地理', '地理 重要事項', '第1問']);
    // セット名を変えて取り込み直すと、カードは新しいセットへ移り、空になった古いセットは消える
    exported[1][2] = exported[2][2] = '共通テスト地理';
    const second = planImport(table(exported).rows, first.catalog, first.write, { deleteMissing: false });
    expect(second.updated).toBe(2);
    expect(second.catalog.subjects[0].units.map((u) => u.name)).toEqual(['共通テスト地理']);
    // セットの並びはファイルの順にそろう（取り込み直したときも）
    const third = planImport(
      table([
        ['科目', 'セット', '表', '裏'],
        ['英語', 'B', 'qb', 'ab'],
        ['地理', '共通テスト地理', 'qg', 'ag'],
        ['英語', 'A', 'qa', 'aa'],
      ]).rows,
      second.catalog,
      second.write,
      { deleteMissing: false },
    );
    expect(third.catalog.subjects.map((x) => [x.name, x.units.map((u) => u.name)])).toEqual([
      ['英語', ['B', 'A']],
      ['地理', ['共通テスト地理']],
    ]);
    expect(Object.values(second.write).flatMap((c) => c.c).map((c) => c.id)).toEqual(cards.map((c) => c.id));
  });
  it('カードが多いとチャンクを分ける', () => {
    const rows = Array.from({ length: MAX_CARDS_PER_CHUNK + 5 }, (_, i) => row(i + 2, `q${i}`, `a${i}`));
    const plan = planImport(rows, null, {}, { deleteMissing: false });
    const sizes = Object.values(plan.write).map((c) => c.c.length);
    expect(sizes).toEqual([MAX_CARDS_PER_CHUNK, 5]);
    expect(Object.keys(plan.write).every((id) => /^s\w+-\d{3}$/.test(id))).toBe(true);
  });
  it('htmlToText はタグがなければそのまま', () => {
    expect(htmlToText('$a<b$')).toBe('$a<b$');
  });
});

const card = (id: string, s = 's', u = 'u'): CardData => ({ id, s, u, f: id, b: id });
const state = (due: number, st: State, extra: Partial<SavedState> = {}): SavedState => ({
  due,
  s: 5,
  d: 5,
  st,
  sd: 1,
  ls: 0,
  r: 1,
  l: 0,
  lr: due - 86_400_000,
  fr: 0,
  ...extra,
});

describe('session', () => {
  const now = at('2026-10-29T10:00:00');
  it('学習中→復習（期限の古い順）に新規を混ぜ、新規は上限まで', () => {
    const cards = ['r1', 'r2', 'r3', 'r4', 'r5', 'l1', 'n1', 'n2', 'n3', 'future'].map((id) => card(id));
    const states = {
      r1: state(now - 3000, State.Review),
      r2: state(now - 5000, State.Review),
      r3: state(at('2026-10-30T03:00:00'), State.Review), // 今日の学習日のうち
      r4: state(now - 1000, State.Review),
      r5: state(now - 2000, State.Review),
      l1: state(now + 60_000, State.Learning),
      future: state(at('2026-10-30T05:00:00'), State.Review), // 明日
    };
    const q = buildQueue(cards, states, now, 2);
    expect(q.learn).toEqual(['l1']);
    expect(q.main).toEqual(['r2', 'r1', 'r5', 'r4', 'n1', 'r3', 'n2']);
    expect(countDue(cards, states, now, 2)).toEqual({ learn: 1, review: 5, fresh: 2, unseen: 3 });
  });
  it('区分でしぼり込む・使わないセット', () => {
    const cs = [
      { ...card('1', 's', 'u'), c: '第1問' },
      { ...card('2', 's', 'u'), c: '第2問' },
      { ...card('3', 's', 'u'), c: '第1問' },
      card('4', 's', 'v'),
    ];
    expect(sectionsOf(cs.slice(0, 3))).toEqual(['第1問', '第2問']);
    expect(sectionsOf([card('9')])).toEqual(['']);
    const scope = { kind: 'unit' as const, subject: 's', unit: 'u', sections: ['第1問'] };
    expect(cs.filter((c) => inScope(c, scope)).map((c) => c.id)).toEqual(['1', '3']);
    expect(cs.filter((c) => inScope(c, { kind: 'unit', subject: 's', unit: 'u' })).map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(isUsed({ [unitKey('s', 'u')]: false }, 's', 'u')).toBe(false);
    expect(isUsed({ [unitKey('s', 'u')]: true }, 's', 'u')).toBe(true);
    expect(isUsed(undefined, 's', 'v')).toBe(true);
  });
  it('セットの重要度と新規カードの上限', () => {
    const imp = { [unitKey('s1', 'u1')]: 'A' as const, [unitKey('s1', 'u3')]: 'C' as const };
    expect(impOf(imp, 's1', 'u1')).toBe('A');
    expect(impOf(imp, 's1', 'u2')).toBe('B');
    expect(impOf(undefined, 's1', 'u1')).toBe('B');
    expect([newLimitFor(20, 'A'), newLimitFor(20, 'B'), newLimitFor(20, 'C'), newLimitFor(0, 'A')]).toEqual([30, 20, 10, 0]);
    const units = ['u1', 'u2', 'u3', 'u4'];
    expect(byImp(units, (u) => impOf(imp, 's1', u))).toEqual(['u1', 'u2', 'u4', 'u3']);
  });
  it('覚えている途中のカードは時間がたつまで出さない（同じカードのくり返しを防ぐ）', () => {
    const base = { main: ['m1'], learn: [{ id: 'x', due: now + 6 * 60_000 }], current: null, revealed: true };
    // まだほかのカードがあればそちらを出す
    expect(pickNext(base, now).current).toBe('m1');
    // 残りが途中のカードだけなら待つ
    const waiting = pickNext({ ...base, main: [] }, now);
    expect(waiting.current).toBeNull();
    expect(waiting.learn).toHaveLength(1);
    // 時間がたてば出す。「今すぐ出す」なら時間前でも出す
    expect(pickNext({ ...base, main: [] }, now + 6 * 60_000).current).toBe('x');
    expect(pickNext({ ...base, main: [] }, now, true).current).toBe('x');
    // 時間が来た途中のカードは、ほかのカードより先に出す
    expect(pickNext(base, now + 7 * 60_000).current).toBe('x');
    // 「今すぐ出す」では、直前に答えたカードより別のカードを先に出す
    const two = { main: [], learn: [{ id: 'x', due: now + 60_000 }, { id: 'y', due: now + 600_000 }], current: null, revealed: true, last: 'x' };
    const forced = pickNext(two, now, true);
    expect(forced.current).toBe('y');
    expect(forced.learn.map((l) => l.id)).toEqual(['x']);
  });
  it('interleave', () => {
    expect(interleave(['a', 'b', 'c'], ['x', 'y', 'z'], 2)).toEqual(['a', 'b', 'x', 'c', 'y', 'z']);
    expect(interleave([], ['x'], 4)).toEqual(['x']);
  });
  it('苦手モードは忘れた回数の多い順', () => {
    const states = { a: state(now, State.Review, { l: 1 }), b: state(now, State.Review, { l: 3 }), c: state(now, State.Review) };
    expect(buildQueue([card('a'), card('b'), card('c')], states, now, 10, 'weak').main).toEqual(['b', 'a']);
  });
  it('今日新しく学んだ数と、7日間の予定', () => {
    const states = {
      a: state(now - 1, State.Review, { fr: at('2026-10-29T05:00:00') }),
      b: state(at('2026-10-31T12:00:00'), State.Review, { fr: at('2026-10-28T23:00:00') }),
    };
    expect(newStudiedToday([card('a'), card('b')], states, now)).toBe(1);
    expect(newStudiedToday([card('b')], states, now)).toBe(0);
    expect(forecast([card('a'), card('b')], states, now)).toEqual([1, 0, 1, 0, 0, 0, 0]);
  });
});

describe('scheduler', () => {
  const now = at('2026-10-29T10:00:00');
  it('新しいカードは 1分 / 6分 / 10分 後', () => {
    const f = makeScheduler(null, now);
    const p = previewNext(f, undefined, now);
    expect((p[Rating.Again].due - now) / 60_000).toBe(1);
    expect((p[Rating.Hard].due - now) / 60_000).toBe(6);
    expect((p[Rating.Good].due - now) / 60_000).toBe(10);
    expect(p[Rating.Good].fr).toBe(now);
  });
  it('入試日を設定すると、次の出題は入試の前日まで', () => {
    expect(maxIntervalFor('2026-11-08', now)).toBe(9);
    expect(maxIntervalFor('2026-10-29', now)).toBe(36500);
    expect(maxIntervalFor(null, now)).toBe(36500);
    const f = makeScheduler('2026-11-08', now);
    const mature = state(now, State.Review, { s: 200, d: 3, sd: 100, lr: now - 100 * 86_400_000, r: 8 });
    const p = previewNext(f, mature, now);
    for (const g of [Rating.Again, Rating.Hard, Rating.Good] as const) {
      expect(p[g].due).toBeLessThanOrEqual(at('2026-11-07T23:59:59'));
    }
    expect(p[Rating.Good].sd).toBeLessThanOrEqual(9);
    // 上限がなければもっと先になる
    const free = previewNext(makeScheduler(null, now), mature, now);
    expect(free[Rating.Good].due).toBeGreaterThan(at('2026-12-01T00:00:00'));
  });
  it('復習で「もう一度」を押すと忘れた回数が増える', () => {
    const f = makeScheduler(null, now);
    const s = state(now, State.Review, { s: 10, sd: 10, lr: now - 10 * 86_400_000 });
    const p = previewNext(f, s, now);
    expect(p[Rating.Again].l).toBe(1);
    expect(p[Rating.Again].st).toBe(State.Relearning);
  });
  it('定着の判定', () => {
    expect(levelOf(undefined)).toBe('new');
    expect(levelOf(state(now, State.Review, { s: 30 }))).toBe('mature');
    expect(levelOf(state(now, State.Review, { s: 5 }))).toBe('learning');
    expect(levelOf(state(now, State.Learning, { s: 30 }))).toBe('learning');
  });
});

describe('progress', () => {
  const now = at('2026-10-29T10:00:00');
  const st = (lr: number): SavedState => state(now + 86_400_000, State.Review, { lr, s: 7 });
  it('学習記録のファイルを読み、形が違う記録は捨てる', () => {
    const f = parseProgressFile(
      JSON.stringify({ format: 'anki-cards-progress', version: 1, source: 'x', states: { a: st(now), b: { due: 'x' } } }),
    );
    expect(Object.keys(f.states)).toEqual(['a']);
    expect(() => parseProgressFile('{"format":"other"}')).toThrow('学習記録のファイルではない');
    expect(() => parseProgressFile('not json')).toThrow('読み取れません');
  });
  it('カードごとに新しいほうを残し、見つからないカードは数える', () => {
    const chunkOf = (id: string) => ({ a: 'c1', b: 'c1', c: 'c2' })[id];
    const plan = planProgressImport(
      { a: st(now - 10), b: st(now - 10), c: st(now - 10), z: st(now) },
      { a: st(now - 20), b: st(now) },
      chunkOf,
    );
    expect([plan.imported, plan.keptNewer, plan.notFound]).toEqual([2, 1, 1]);
    expect(Object.keys(plan.writes.c1)).toEqual(['a']);
    expect(Object.keys(plan.writes.c2)).toEqual(['c']);
  });
});

describe('edit', () => {
  // 英語に「熟語A」「熟語B」、地理に「地理」の3セット
  const rows = (subject: string, unit: string, section: string, n: number, prefix: string): ImportRow[] =>
    Array.from({ length: n }, (_, i) => ({ line: i + 2, id: `${prefix}${i}`, subject, unit, section, front: `${prefix}q${i}`, back: 'a', note: '', tags: [] }));
  const base = planImport(
    [...rows('英語', '熟語A', '', 2, 'a'), ...rows('英語', '熟語B', 'x', 1, 'b'), ...rows('地理', '地理', '第1問', 2, 'g')],
    null,
    {},
    { deleteMissing: false },
  );
  const cat = base.catalog;
  const chunks = base.write;
  const eng = cat.subjects[0];
  const geo = cat.subjects[1];
  const [setA, setB] = eng.units;
  const all = (p: { write: Record<string, ChunkDoc> }, before = chunks) => Object.values({ ...before, ...p.write }).flatMap((c) => c.c);

  it('セットの名前を変える・同じ名前は断る', () => {
    expect(renameSet(cat, eng.id, setA.id, '英熟語').subjects[0].units[0].name).toBe('英熟語');
    expect(() => renameSet(cat, eng.id, setA.id, '熟語B')).toThrow('すでにあります');
  });
  it('セットをまとめると、区分のないカードは元のセット名が区分になり、IDは変わらない', () => {
    const p = mergeSet(cat, chunks, { subject: eng.id, unit: setA.id }, { subject: eng.id, unit: setB.id });
    expect(p.changed).toBe(2);
    expect(p.catalog.subjects[0].units.map((u) => [u.name, u.count])).toEqual([['熟語B', 3]]);
    const cards = all(p).filter((c) => c.s === eng.id);
    expect(cards.map((c) => [c.id, c.u === setB.id, c.c])).toEqual([
      ['a0', true, '熟語A'],
      ['a1', true, '熟語A'],
      ['b0', true, 'x'],
    ]);
  });
  it('区分の名前を変える・まとめる・なくす', () => {
    const p = renameSections(cat, chunks, geo.id, geo.units[0].id, ['第1問'], '第一問');
    expect(all(p).filter((c) => c.s === geo.id).map((c) => c.c)).toEqual(['第一問', '第一問']);
    const none = renameSections(cat, chunks, geo.id, geo.units[0].id, ['第1問'], '');
    expect(all(none).filter((c) => c.s === geo.id).every((c) => c.c === undefined)).toBe(true);
  });
  it('区分を新しいセットへ移す', () => {
    const p = moveSections(cat, chunks, eng.id, setB.id, ['x'], { newUnit: '熟語C' });
    expect(p.catalog.subjects[0].units.map((u) => [u.name, u.count])).toEqual([
      ['熟語A', 2],
      ['熟語C', 1],
    ]);
  });
  it('セットをほかの科目へ移す・新しい科目も作れる', () => {
    const p = moveSetToSubject(cat, chunks, eng.id, setB.id, { newSubject: '国語' });
    expect(p.catalog.subjects.map((s) => [s.name, s.units.map((u) => u.name)])).toEqual([
      ['英語', ['熟語A']],
      ['地理', ['地理']],
      ['国語', ['熟語B']],
    ]);
  });
  it('セットとカードを削除する。空になったチャンクは消す', () => {
    const p = deleteSet(cat, chunks, geo.id, geo.units[0].id);
    expect(p.catalog.subjects.map((s) => s.name)).toEqual(['英語']);
    expect(p.remove).toHaveLength(1);
    const q = deleteCard(cat, chunks, 'a0');
    expect(q.catalog.subjects[0].units[0].count).toBe(1);
  });
  it('並びを動かす', () => {
    expect(moveSetOrder(cat, eng.id, setB.id, -1).subjects[0].units.map((u) => u.name)).toEqual(['熟語B', '熟語A']);
    expect(moveSetOrder(cat, eng.id, setA.id, -1)).toBe(cat);
  });
  it('1枚だけ編集しても並びは変わらない', () => {
    const row: ImportRow = { line: 2, id: 'g0', subject: '地理', unit: '地理', section: '第2問', front: 'gq0', back: 'a', note: '', tags: [] };
    const p = planImport([row], cat, chunks, { deleteMissing: false, keepOrder: true });
    expect(p.updated).toBe(1);
    expect(p.catalog.subjects.map((s) => s.name)).toEqual(['英語', '地理']);
  });
});

describe('edit names', () => {
  it('名前の全角記号はそのまま残し、表記ゆれは同じ名前として扱う', () => {
    const base = planImport(
      [{ line: 2, id: 'x', subject: '英語', unit: '和文英訳', section: '鉄緑', front: 'q', back: 'a', note: '', tags: [] }],
      null,
      {},
      { deleteMissing: false },
    );
    const s = base.catalog.subjects[0];
    expect(renameSet(base.catalog, s.id, s.units[0].id, '和文英訳（鉄緑・入試）').subjects[0].units[0].name).toBe('和文英訳（鉄緑・入試）');
    const p = renameSections(base.catalog, base.write, s.id, s.units[0].id, ['鉄緑'], '鉄緑（テーマ英作）');
    expect(Object.values(p.write).flatMap((c) => c.c)[0].c).toBe('鉄緑（テーマ英作）');
  });
});
