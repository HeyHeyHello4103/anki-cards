export type Role = 'admin' | 'member';

/** Firestore に保存するカード（キー名は容量節約のため短縮） */
export interface CardData {
  id: string;
  /** 科目ID */
  s: string;
  /** セット（単元）ID */
  u: string;
  /** 区分（セットを開いたときに絞り込む単位。例：第1問） */
  c?: string;
  /** 表（問題） */
  f: string;
  /** 裏（答え） */
  b: string;
  /** 解説 */
  n?: string;
  /** タグ */
  t?: string[];
}

/** cards/{chunkId} の中身 */
export interface ChunkDoc {
  /** 主にどの科目のカードを入れているか（新規カードの配置先を決めるための目印） */
  s: string;
  c: CardData[];
}

export interface UnitMeta {
  id: string;
  name: string;
  count: number;
}

export interface SubjectMeta {
  id: string;
  name: string;
  count: number;
  units: UnitMeta[];
}

/** catalog/main */
export interface Catalog {
  subjects: SubjectMeta[];
  total: number;
  updatedAt: number;
}

/** 利用者ごとのカードの学習状態（users/{uid}/states/{chunkId} の c.{cardId}） */
export interface SavedState {
  due: number;
  /** 状態（0 未学習・1 学習中・2 復習・3 忘れて覚え直し中） */
  st: number;
  /** 間隔（日）。覚え直し中は、覚え直したあとに使う間隔 */
  sd: number;
  /** 易しさ係数（「覚えた」で間隔を何倍にするか）。以前の方式の記録にはない */
  e?: number;
  /** 続けて覚えていた回数（忘れると 0 に戻る） */
  r: number;
  /** lapses（覚えたあとで忘れた回数） */
  l: number;
  /** 以前の方式（FSRS）の記録にだけある：安定度・難しさ・学習ステップ */
  s?: number;
  d?: number;
  ls?: number;
  /** last_review */
  lr: number | null;
  /** 初めて学習した日時 */
  fr: number;
}

/** 1日分の学習記録 */
export interface DayAct {
  /** 回答数 */
  n: number;
  /** 「もう一度」の数 */
  a: number;
  /** 新しく学習したカード数 */
  nw: number;
}

/** セットの重要度（利用者ごとに設定。設定していないセットは B） */
export type Imp = 'A' | 'B' | 'C';

export interface UserSettings {
  examDate: string | null;
  newPerDay: number;
  /** セットごとの重要度。キーは unitKey(科目ID, セットID) */
  imp: Record<string, Imp>;
  /** 使わないセット（false）。書いていないセットは使う */
  use: Record<string, boolean>;
}

export interface SubjectSummary {
  /** 学習中 */
  l: number;
  /** 定着 */
  m: number;
}

/** users/{uid} */
export interface UserDoc {
  email?: string;
  name?: string;
  settings?: Partial<UserSettings>;
  act?: Record<string, DayAct>;
  sum?: {
    last?: number;
    total?: number;
    subj?: Record<string, SubjectSummary>;
  };
}

/** members/{email} */
export interface MemberDoc {
  role: Role;
  name?: string;
  addedAt?: number;
}

export const DEFAULT_SETTINGS: UserSettings = { examDate: null, newPerDay: 20, imp: {}, use: {} };
