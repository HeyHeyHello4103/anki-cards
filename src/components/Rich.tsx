import { renderRich } from '../lib/render';

/** カードの文字列（数式・化学式・太字・改行）を表示する */
export function Rich({ text, className }: { text: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: renderRich(text) }} />;
}
