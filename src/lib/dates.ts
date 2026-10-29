/** 夜遅くの学習を前日分として数えるため、1日の区切りを午前4時にする */
export const DAY_START_HOUR = 4;
export const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, '0');

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** now が属する「学習日」の開始時刻 */
export function studyDayStart(now: number): number {
  const d = new Date(now);
  d.setHours(DAY_START_HOUR, 0, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

export function nextStudyDayStart(now: number): number {
  const d = new Date(studyDayStart(now));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** 学習日を YYYY-MM-DD で表す */
export function dayKey(now: number): string {
  return ymd(new Date(studyDayStart(now)));
}

export function addDays(key: string, n: number): string {
  const d = parseYmd(key);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** 今日（学習日）から date までの日数。当日なら 0 */
export function daysUntil(date: string, now: number): number {
  return Math.round((parseYmd(date).getTime() - parseYmd(dayKey(now)).getTime()) / DAY_MS);
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function formatDayJa(key: string): string {
  const d = parseYmd(key);
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
}

export function formatRelative(ts: number | undefined, now: number): string {
  if (!ts) return '未学習';
  const days = Math.round((parseYmd(dayKey(now)).getTime() - parseYmd(dayKey(ts)).getTime()) / DAY_MS);
  if (days <= 0) return '今日';
  if (days === 1) return '昨日';
  return `${days}日前`;
}
