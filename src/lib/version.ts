import { useEffect, useState } from 'react';

export const APP_VERSION = __APP_VERSION__;
export const BUILT_AT = __BUILT_AT__;

const CHECK_EVERY_MS = 15 * 60_000;

/**
 * 公開中の版と、いま開いている画面の版が違えば true。
 * 開いたままのタブやホーム画面のアプリが古い画面のままになるのを知らせるため、
 * 起動時・画面に戻ったとき・15分ごとに version.json を確かめる。
 */
export function useUpdateAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (APP_VERSION === 'dev') return;
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch('./version.json', { cache: 'no-store' });
        if (!res.ok) return;
        const { version } = (await res.json()) as { version?: string };
        if (!stopped && version && version !== APP_VERSION) setAvailable(true);
      } catch {
        // 電波がないときは確かめない
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && void check();
    const first = setTimeout(check, 3000);
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return available;
}

export function formatBuiltAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
