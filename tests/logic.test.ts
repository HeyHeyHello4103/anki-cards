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
import { checkMath, plainText, renderRich, tokenize } from '../src/lib/render';
import { levelOf, makeScheduler, maxIntervalFor, previewNext, Rating, State } from '../src/lib/scheduler';
import { buildQueue, countDue, forecast, interleave, newStudiedToday } from '../src/lib/session';
import type { CardData, SavedState } from '../src/lib/types';

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
    exported[1][4] = '1（修正）';
    const rows2 = table(exported).rows.slice(0, 2);
    const second = planImport(rows2, first.catalog, first.write, { deleteMissing: true });
    expect([second.added, second.updated, second.unchanged, second.deleted]).toEqual([0, 1, 1, 1]);
    expect(second.catalog.subjects.map((s) => s.name)).toEqual(['数学']);
    expect(second.remove).toHaveLength(1);
    const fixed = Object.values(second.write).flatMap((c) => c.c).find((c) => c.f === 'a');
    expect(fixed?.b).toBe('1（修正）');
    expect(fixed?.id).toBe(cards.find((c) => c.f === 'a')?.id);
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
    expect(newStudiedToday(states, now)).toBe(1);
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
