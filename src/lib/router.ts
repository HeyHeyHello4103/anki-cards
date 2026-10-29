import { useEffect, useState } from 'react';

/** URL の # 以降を「/」で区切って返す（GitHub Pages でも動くようハッシュで画面を切り替える） */
export function useRoute(): string[] {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent);
}

export function go(path: string) {
  location.hash = path;
}
