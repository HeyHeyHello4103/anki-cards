import katex from 'katex';
import 'katex/contrib/mhchem';

/**
 * カードの文字列をHTMLにする。
 * - `$...$` は数式、`$$...$$` は独立した行の数式（KaTeX）
 * - `\ce{...}` は化学式（$ で囲まなくてもよい）
 * - `**...**` は太字、改行はそのまま改行
 * - 数式ではない `$` は `\$` と書く
 */

type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'math'; tex: string; display: boolean };

export interface Tokenized {
  segments: Segment[];
  /** 閉じられていない `$` があった */
  unclosed: boolean;
}

/** from 以降で、直前が `\` でない marker の位置を探す */
function findClosing(src: string, marker: string, from: number): number {
  let i = src.indexOf(marker, from);
  while (i !== -1 && src[i - 1] === '\\') i = src.indexOf(marker, i + 1);
  return i;
}

/** `{` から対応する `}` の位置を返す。なければ -1 */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

export function tokenize(src: string): Tokenized {
  const segments: Segment[] = [];
  let text = '';
  let unclosed = false;
  const flush = () => {
    if (text) segments.push({ kind: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < src.length) {
    if (src[i] === '\\' && src[i + 1] === '$') {
      text += '$';
      i += 2;
    } else if (src.startsWith('$$', i)) {
      const end = findClosing(src, '$$', i + 2);
      if (end === -1) {
        unclosed = true;
        text += '$$';
        i += 2;
      } else {
        flush();
        segments.push({ kind: 'math', tex: src.slice(i + 2, end), display: true });
        i = end + 2;
      }
    } else if (src[i] === '$') {
      const end = findClosing(src, '$', i + 1);
      if (end === -1) {
        unclosed = true;
        text += '$';
        i += 1;
      } else {
        flush();
        segments.push({ kind: 'math', tex: src.slice(i + 1, end), display: false });
        i = end + 1;
      }
    } else if (src.startsWith('\\ce{', i)) {
      const end = matchBrace(src, i + 3);
      if (end === -1) {
        text += src[i];
        i += 1;
      } else {
        flush();
        segments.push({ kind: 'math', tex: src.slice(i, end + 1), display: false });
        i = end + 1;
      }
    } else {
      text += src[i];
      i += 1;
    }
  }
  flush();
  return { segments, unclosed };
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function textToHtml(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\r?\n/g, '<br>');
}

const cache = new Map<string, string>();

export function renderRich(src: string): string {
  const hit = cache.get(src);
  if (hit !== undefined) return hit;
  const html = tokenize(src)
    .segments.map((seg) =>
      seg.kind === 'text'
        ? textToHtml(seg.text)
        : katex.renderToString(seg.tex, { displayMode: seg.display, throwOnError: false, output: 'html' }),
    )
    .join('');
  if (cache.size > 3000) cache.clear();
  cache.set(src, html);
  return html;
}

/** 数式の書き方の誤りを返す（なければ空配列） */
export function checkMath(src: string): string[] {
  const { segments, unclosed } = tokenize(src);
  const errors: string[] = [];
  if (unclosed) errors.push('閉じられていない「$」があります（数式でない $ は \\$ と書きます）');
  for (const seg of segments) {
    if (seg.kind !== 'math') continue;
    try {
      katex.renderToString(seg.tex, { displayMode: seg.display, throwOnError: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/^KaTeX parse error: /, '') : String(e);
      errors.push(`数式「${seg.tex.slice(0, 40)}」: ${msg}`);
    }
  }
  return errors;
}

/** 一覧表示用に、記法を外した短い文字列にする */
export function plainText(src: string, max = 60): string {
  const s = tokenize(src)
    .segments.map((seg) => (seg.kind === 'text' ? seg.text : seg.tex))
    .join('')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}
