import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { db } from './firebase';
import { summarize } from './session';
import { Syncer } from './sync';
import {
  DEFAULT_SETTINGS,
  type CardData,
  type Catalog,
  type ChunkDoc,
  type DayAct,
  type MemberDoc,
  type SavedState,
  type SubjectSummary,
  type UserDoc,
  type UserSettings,
} from './types';

export interface AppData {
  uid: string;
  email: string;
  displayName: string;
  member: MemberDoc;
  isAdmin: boolean;
  ready: boolean;
  loadError: string | null;
  catalog: Catalog | null;
  chunks: Record<string, ChunkDoc>;
  /** 科目・単元の並び順にそろえた全カード */
  cards: CardData[];
  cardById: Map<string, CardData>;
  states: Record<string, SavedState>;
  userDoc: UserDoc;
  settings: UserSettings;
  act: Record<string, DayAct>;
  sync: Syncer;
  /** カードが入っているチャンク（学習状態の保存先） */
  chunkOf: (cardId: string) => string | undefined;
  subjectName: (sid: string) => string;
  unitName: (sid: string, uid: string) => string;
}

const Ctx = createContext<AppData | null>(null);

export function useData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error('DataProvider がありません');
  return v;
}

function orderCards(catalog: Catalog | null, chunks: Record<string, ChunkDoc>): CardData[] {
  const rank = new Map<string, number>();
  catalog?.subjects.forEach((s, si) => s.units.forEach((u, ui) => rank.set(s.id + '/' + u.id, si * 10_000 + ui)));
  const all: CardData[] = [];
  for (const id of Object.keys(chunks).sort()) all.push(...chunks[id].c);
  const r = (c: CardData) => rank.get(c.s + '/' + c.u) ?? Number.MAX_SAFE_INTEGER;
  return all.map((c, i) => ({ c, i })).sort((a, b) => r(a.c) - r(b.c) || a.i - b.i).map((x) => x.c);
}

export function DataProvider(props: { uid: string; email: string; displayName: string; member: MemberDoc; children: ReactNode }) {
  const { uid, email, displayName, member } = props;
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [chunks, setChunks] = useState<Record<string, ChunkDoc>>({});
  const [baseStates, setBaseStates] = useState<Record<string, SavedState>>({});
  const [userDoc, setUserDoc] = useState<UserDoc>({});
  const [loaded, setLoaded] = useState({ catalog: false, chunks: false, states: false, user: false });
  const [loadError, setLoadError] = useState<string | null>(null);

  const chunkOfRef = useRef(new Map<string, string>());
  const summaryRef = useRef<() => Record<string, SubjectSummary>>(() => ({}));
  const sync = useMemo(
    () => new Syncer(uid, (id) => chunkOfRef.current.get(id), () => summaryRef.current()),
    [uid],
  );
  const syncVersion = useSyncExternalStore(
    (fn) => sync.subscribe(fn),
    () => sync.version,
  );

  useEffect(() => {
    const fail = (e: Error) => setLoadError(e.message);
    const unsubs = [
      onSnapshot(doc(db, 'catalog', 'main'), (s) => {
        setCatalog(s.exists() ? (s.data() as Catalog) : null);
        setLoaded((l) => ({ ...l, catalog: true }));
      }, fail),
      onSnapshot(collection(db, 'cards'), (q) => {
        const next: Record<string, ChunkDoc> = {};
        q.forEach((d) => (next[d.id] = d.data() as ChunkDoc));
        setChunks(next);
        setLoaded((l) => ({ ...l, chunks: true }));
      }, fail),
      onSnapshot(collection(db, 'users', uid, 'states'), (q) => {
        const next: Record<string, SavedState> = {};
        q.forEach((d) => Object.assign(next, (d.data() as { c?: Record<string, SavedState> }).c ?? {}));
        setBaseStates(next);
        setLoaded((l) => ({ ...l, states: true }));
      }, fail),
      onSnapshot(doc(db, 'users', uid), (s) => {
        const data = (s.data() ?? {}) as UserDoc;
        setUserDoc(data);
        sync.onUserDocSnapshot();
        setLoaded((l) => ({ ...l, user: true }));
        // 初回ログイン時、または表示名が変わったときに登録する（管理者の一覧に表示するため）
        if (!s.metadata.fromCache && (data.email !== email || data.name !== displayName)) {
          setDoc(doc(db, 'users', uid), { email, name: displayName }, { merge: true }).catch(fail);
        }
      }, fail),
    ];
    const flush = () => sync.flush();
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      flush();
      unsubs.forEach((u) => u());
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
    };
  }, [uid, email, displayName, sync]);

  const cards = useMemo(() => orderCards(catalog, chunks), [catalog, chunks]);
  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const chunkOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, ch] of Object.entries(chunks)) for (const c of ch.c) m.set(c.id, id);
    return m;
  }, [chunks]);
  chunkOfRef.current = chunkOf;

  const states = useMemo(() => {
    const out = { ...baseStates };
    for (const [id, v] of Object.entries(sync.overlay)) {
      if (v === null) delete out[id];
      else out[id] = v;
    }
    return out;
    // overlay は syncVersion が変わるたびに取り込み直す
  }, [baseStates, syncVersion, sync]);

  summaryRef.current = () => summarize(cards, states);

  const act = useMemo(() => sync.mergeAct(userDoc.act), [userDoc, syncVersion, sync]);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of catalog?.subjects ?? []) {
      m.set(s.id, s.name);
      for (const u of s.units) m.set(s.id + '/' + u.id, u.name);
    }
    return m;
  }, [catalog]);

  const value: AppData = {
    uid,
    email,
    displayName,
    member,
    isAdmin: member.role === 'admin',
    ready: loaded.catalog && loaded.chunks && loaded.states && loaded.user,
    loadError: loadError ?? sync.error,
    catalog,
    chunks,
    cards,
    cardById,
    states,
    userDoc,
    settings: { ...DEFAULT_SETTINGS, ...(userDoc.settings ?? {}) },
    act,
    sync,
    chunkOf: (id) => chunkOf.get(id),
    subjectName: (sid) => names.get(sid) ?? '（削除された科目）',
    unitName: (sid, u) => names.get(sid + '/' + u) ?? '（削除されたセット）',
  };
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}
