import { useMemo, useState } from 'react';
import { Rich } from '../components/Rich';
import { commitPlan } from '../lib/commit';
import {
  deleteCard,
  deleteSet,
  mergeSet,
  moveSections,
  moveSetOrder,
  moveSetToSubject,
  renameSections,
  renameSet,
  renameSubject,
  type EditPlan,
} from '../lib/edit';
import { planImport, validateRows, type ImportRow } from '../lib/importer';
import { plainText } from '../lib/render';
import { sectionsOf } from '../lib/session';
import { useData } from '../lib/store';
import type { CardData, Catalog } from '../lib/types';

type Msg = { kind: 'ok' | 'error'; text: string } | null;
type Plan = Pick<EditPlan, 'catalog' | 'write' | 'remove'>;

/** 編集を Firestore に書き込む。科目一覧だけの変更（名前・並び）にも使う */
function useCommit() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const run = async (make: () => Plan | Catalog, done: string) => {
    setMsg(null);
    let plan: Plan;
    try {
      const r = make();
      plan = 'catalog' in r ? r : { catalog: r, write: {}, remove: [] };
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
      return false;
    }
    setBusy(true);
    try {
      await commitPlan(plan);
      setMsg({ kind: 'ok', text: done });
      return true;
    } catch (e) {
      setMsg({ kind: 'error', text: `保存できませんでした: ${(e as Error).message}` });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, msg, run };
}

export function AdminEdit() {
  const d = useData();
  if (!d.catalog || d.cards.length === 0) {
    return <p className="muted">カードがまだありません。「カード」タブからCSVを取り込むか、下の「カードを追加」から作ってください。</p>;
  }
  return (
    <div className="stack">
      <SetOrganizer catalog={d.catalog} />
      <CardEditor catalog={d.catalog} />
    </div>
  );
}

/* ---------------- セットと区分の整理 ---------------- */

function SetOrganizer({ catalog }: { catalog: Catalog }) {
  const d = useData();
  const [open, setOpen] = useState<string | null>(null);
  const [subjectEdit, setSubjectEdit] = useState<{ id: string; name: string } | null>(null);
  const { busy, msg, run } = useCommit();

  return (
    <section className="panel stack">
      <div>
        <h2 style={{ margin: 0 }}>セットと区分の整理</h2>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          名前の変更・まとめ・移動はすぐ全員に反映されます。カードのIDは変わらないので、学習記録はそのまま残ります。
        </p>
      </div>
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
      {catalog.subjects.map((s) => (
        <div key={s.id} className="edit-subject">
          <div className="row">
            {subjectEdit?.id === s.id ? (
              <>
                <input type="text" value={subjectEdit.name} onChange={(e) => setSubjectEdit({ id: s.id, name: e.target.value })} style={{ flex: 1 }} />
                <button
                  className="btn small primary"
                  disabled={busy}
                  onClick={async () => (await run(() => renameSubject(catalog, s.id, subjectEdit.name), '科目の名前を変えました')) && setSubjectEdit(null)}
                >
                  保存
                </button>
                <button className="btn small" onClick={() => setSubjectEdit(null)}>
                  やめる
                </button>
              </>
            ) : (
              <>
                <b style={{ fontSize: 16 }}>{s.name}</b>
                <span className="small muted">{s.count}枚</span>
                <span className="spacer" />
                <button className="btn small" onClick={() => setSubjectEdit({ id: s.id, name: s.name })}>
                  名前を変える
                </button>
              </>
            )}
          </div>
          {s.units.map((u, i) => {
            const key = s.id + '/' + u.id;
            const sections = sectionsOf(d.cards.filter((c) => c.s === s.id && c.u === u.id)).filter(Boolean);
            return (
              <div key={u.id} className="edit-set">
                <div className="row">
                  <span className="set-name" style={{ flex: 1, minWidth: 0 }}>
                    {u.name}
                    <span className="small muted" style={{ fontWeight: 400 }}>
                      {' '}
                      {u.count}枚{sections.length > 0 && `・区分${sections.length}`}
                    </span>
                  </span>
                  <button className="btn small" aria-label="上へ" disabled={busy || i === 0} onClick={() => run(() => moveSetOrder(catalog, s.id, u.id, -1), '並びを変えました')}>
                    ↑
                  </button>
                  <button
                    className="btn small"
                    aria-label="下へ"
                    disabled={busy || i === s.units.length - 1}
                    onClick={() => run(() => moveSetOrder(catalog, s.id, u.id, 1), '並びを変えました')}
                  >
                    ↓
                  </button>
                  <button className={`btn small ${open === key ? 'primary' : ''}`} onClick={() => setOpen(open === key ? null : key)}>
                    {open === key ? '閉じる' : '編集'}
                  </button>
                </div>
                {open === key && <SetEditor catalog={catalog} subject={s.id} unit={u.id} run={run} busy={busy} onGone={() => setOpen(null)} />}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}

function SetEditor(props: {
  catalog: Catalog;
  subject: string;
  unit: string;
  busy: boolean;
  run: (make: () => Plan | Catalog, done: string) => Promise<boolean>;
  onGone: () => void;
}) {
  const { catalog, subject, unit, busy, run, onGone } = props;
  const d = useData();
  const s = catalog.subjects.find((x) => x.id === subject)!;
  const u = s.units.find((x) => x.id === unit)!;
  const cards = d.cards.filter((c) => c.s === subject && c.u === unit);
  const sections = sectionsOf(cards);
  const count = (name: string) => cards.filter((c) => (c.c ?? '') === name).length;

  const [name, setName] = useState(u.name);
  const [mergeTo, setMergeTo] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sectionName, setSectionName] = useState('');
  const [sectionTo, setSectionTo] = useState('');
  const [newSet, setNewSet] = useState('');

  const others = catalog.subjects.flatMap((x) => x.units.filter((y) => !(x.id === subject && y.id === unit)).map((y) => ({ s: x, u: y })));
  const pickedList = sections.filter((x) => picked.has(x));
  const pickedCount = pickedList.reduce((n, x) => n + count(x), 0);

  return (
    <div className="set-editor stack">
      <div className="edit-block">
        <div className="edit-label">セットの名前</div>
        <div className="row">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
          <button className="btn small primary" disabled={busy || name.trim() === u.name} onClick={() => run(() => renameSet(catalog, subject, unit, name), 'セットの名前を変えました')}>
            名前を変える
          </button>
        </div>
      </div>

      <div className="edit-block">
        <div className="edit-label">区分（{sections.filter(Boolean).length}）</div>
        {sections.length === 1 && sections[0] === '' ? (
          <p className="small muted" style={{ margin: 0 }}>
            区分はありません。カードの編集で区分を付けるか、ほかのセットをこのセットにまとめると、元のセット名が区分になります。
          </p>
        ) : (
          <>
            <div className="section-list">
              {sections.map((x) => (
                <label className="section-row" key={x || '(none)'}>
                  <input
                    type="checkbox"
                    checked={picked.has(x)}
                    onChange={() =>
                      setPicked((p) => {
                        const n = new Set(p);
                        if (n.has(x)) n.delete(x);
                        else n.add(x);
                        return n;
                      })
                    }
                  />
                  <span className="section-name">{x || '（区分なし）'}</span>
                  <span className="section-nums">{count(x)}枚</span>
                </label>
              ))}
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              区分を選んで（{pickedList.length}つ・{pickedCount}枚）、名前を変えたりほかのセットへ移したりできます。複数選んで同じ名前にすると1つにまとまります。
            </p>
            <div className="row">
              <input
                type="text"
                placeholder="新しい区分の名前（空にすると区分なし）"
                value={sectionName}
                onChange={(e) => setSectionName(e.target.value)}
                style={{ flex: 1, minWidth: 160 }}
              />
              <button
                className="btn small primary"
                disabled={busy || pickedList.length === 0}
                onClick={async () => {
                  if (await run(() => renameSections(catalog, d.chunks, subject, unit, pickedList, sectionName), `${pickedCount}枚の区分を変えました`)) {
                    setPicked(new Set());
                    setSectionName('');
                  }
                }}
              >
                {pickedList.length > 1 ? '1つにまとめる' : '名前を変える'}
              </button>
            </div>
            <div className="row">
              <select value={sectionTo} onChange={(e) => setSectionTo(e.target.value)} style={{ flex: 1, minWidth: 160 }}>
                <option value="">移す先のセットを選ぶ</option>
                {s.units
                  .filter((y) => y.id !== unit)
                  .map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.name}
                    </option>
                  ))}
                <option value="__new">新しいセットを作る…</option>
              </select>
              {sectionTo === '__new' && (
                <input type="text" placeholder="新しいセットの名前" value={newSet} onChange={(e) => setNewSet(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
              )}
              <button
                className="btn small"
                disabled={busy || pickedList.length === 0 || !sectionTo}
                onClick={async () => {
                  const target = sectionTo === '__new' ? { newUnit: newSet } : { unit: sectionTo };
                  if (await run(() => moveSections(catalog, d.chunks, subject, unit, pickedList, target), `${pickedCount}枚をほかのセットへ移しました`)) {
                    setPicked(new Set());
                    if (pickedList.length === sections.length) onGone();
                  }
                }}
              >
                移す
              </button>
            </div>
          </>
        )}
      </div>

      <div className="edit-block">
        <div className="edit-label">ほかのセットにまとめる</div>
        <div className="row">
          <select value={mergeTo} onChange={(e) => setMergeTo(e.target.value)} style={{ flex: 1, minWidth: 160 }}>
            <option value="">まとめ先のセットを選ぶ</option>
            {others.map(({ s: x, u: y }) => (
              <option key={x.id + '/' + y.id} value={x.id + '/' + y.id}>
                {x.id === subject ? y.name : `${x.name} › ${y.name}`}
              </option>
            ))}
          </select>
          <button
            className="btn small"
            disabled={busy || !mergeTo}
            onClick={async () => {
              const [ts, tu] = mergeTo.split('/');
              const target = others.find((o) => o.s.id === ts && o.u.id === tu)!;
              if (!confirm(`「${u.name}」（${u.count}枚）を「${target.u.name}」にまとめます。区分のないカードには「${u.name}」を区分として付けます。よろしいですか？`)) return;
              if (await run(() => mergeSet(catalog, d.chunks, { subject, unit }, { subject: ts, unit: tu }), `「${target.u.name}」にまとめました`)) onGone();
            }}
          >
            まとめる
          </button>
        </div>
      </div>

      <div className="edit-block">
        <div className="edit-label">ほかの科目へ移す</div>
        <div className="row">
          <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} style={{ flex: 1, minWidth: 140 }}>
            <option value="">移す先の科目を選ぶ</option>
            {catalog.subjects
              .filter((x) => x.id !== subject)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            <option value="__new">新しい科目を作る…</option>
          </select>
          {moveTo === '__new' && (
            <input type="text" placeholder="新しい科目の名前" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} style={{ flex: 1, minWidth: 120 }} />
          )}
          <button
            className="btn small"
            disabled={busy || !moveTo}
            onClick={async () => {
              const target = moveTo === '__new' ? { newSubject } : { subject: moveTo };
              if (await run(() => moveSetToSubject(catalog, d.chunks, subject, unit, target), 'ほかの科目へ移しました')) onGone();
            }}
          >
            移す
          </button>
        </div>
      </div>

      <div className="edit-block">
        <button
          className="btn small danger"
          disabled={busy}
          onClick={async () => {
            if (!confirm(`「${u.name}」のカード${u.count}枚をすべて削除します。全員の学習記録からも見えなくなり、元に戻せません。よろしいですか？`)) return;
            if (await run(() => deleteSet(catalog, d.chunks, subject, unit), 'セットを削除しました')) onGone();
          }}
        >
          このセットをカードごと削除
        </button>
      </div>
    </div>
  );
}

/* ---------------- カードを探して直す・追加する ---------------- */

interface Draft {
  id: string;
  subject: string;
  unit: string;
  section: string;
  front: string;
  back: string;
  note: string;
  tags: string;
}

function CardEditor({ catalog }: { catalog: Catalog }) {
  const d = useData();
  const [q, setQ] = useState('');
  const [setFilter, setSetFilter] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const { busy, msg, run } = useCommit();

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle && !setFilter) return [];
    const out: CardData[] = [];
    for (const c of d.cards) {
      if (setFilter && c.s + '/' + c.u !== setFilter) continue;
      if (needle && !`${c.f}\n${c.b}\n${c.n ?? ''}\n${c.c ?? ''}`.toLowerCase().includes(needle)) continue;
      out.push(c);
      if (out.length >= 50) break;
    }
    return out;
  }, [d.cards, q, setFilter]);

  const openCard = (c: CardData) =>
    setDraft({
      id: c.id,
      subject: d.subjectName(c.s),
      unit: d.unitName(c.s, c.u),
      section: c.c ?? '',
      front: c.f,
      back: c.b,
      note: c.n ?? '',
      tags: (c.t ?? []).join(' '),
    });

  const newCard = () => {
    const [sid, uid] = setFilter ? setFilter.split('/') : [catalog.subjects[0]?.id, catalog.subjects[0]?.units[0]?.id];
    setDraft({
      id: '',
      subject: sid ? d.subjectName(sid) : '',
      unit: sid && uid ? d.unitName(sid, uid) : '',
      section: '',
      front: '',
      back: '',
      note: '',
      tags: '',
    });
  };

  return (
    <section className="panel stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>カードを探して直す</h2>
        <span className="spacer" />
        <button className="btn small primary" onClick={newCard}>
          ＋ カードを追加
        </button>
      </div>
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
      {draft && (
        <CardForm
          catalog={catalog}
          draft={draft}
          setDraft={setDraft}
          busy={busy}
          onSave={async (row) => {
            const ok = await run(
              () => planImport([row], catalog, d.chunks, { deleteMissing: false, keepOrder: true }),
              row.id ? 'カードを直しました' : 'カードを追加しました',
            );
            if (ok) setDraft(null);
          }}
          onDelete={async () => {
            if (!confirm('このカードを削除します。元に戻せません。よろしいですか？')) return;
            if (await run(() => deleteCard(catalog, d.chunks, draft.id), 'カードを削除しました')) setDraft(null);
          }}
        />
      )}
      <div className="row">
        <input type="search" placeholder="表・裏・解説の文字で探す" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 2, minWidth: 180 }} />
        <select value={setFilter} onChange={(e) => setSetFilter(e.target.value)} style={{ flex: 1, minWidth: 140 }}>
          <option value="">すべてのセット</option>
          {catalog.subjects.map((s) => (
            <optgroup key={s.id} label={s.name}>
              {s.units.map((u) => (
                <option key={u.id} value={s.id + '/' + u.id}>
                  {u.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {(q.trim() || setFilter) && (
        <ul className="weak-list">
          {results.length === 0 && <li className="muted">見つかりませんでした</li>}
          {results.map((c) => (
            <li key={c.id} className="card-hit" onClick={() => openCard(c)}>
              <div className="q">
                <div>{plainText(c.f)}</div>
                <div className="a">
                  {plainText(c.b, 40)}・{d.unitName(c.s, c.u)}
                  {c.c ? ` › ${c.c}` : ''}
                </div>
              </div>
              <span className="pill">直す</span>
            </li>
          ))}
          {results.length >= 50 && <li className="small muted">最初の50枚を表示しています。文字やセットでしぼり込んでください。</li>}
        </ul>
      )}
    </section>
  );
}

function CardForm(props: {
  catalog: Catalog;
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  busy: boolean;
  onSave: (row: ImportRow) => void;
  onDelete: () => void;
}) {
  const { catalog, draft, setDraft, busy, onSave, onDelete } = props;
  const d = useData();
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const subject = catalog.subjects.find((s) => s.name === draft.subject);
  const unit = subject?.units.find((u) => u.name === draft.unit);
  const sections = unit ? sectionsOf(d.cards.filter((c) => c.s === subject!.id && c.u === unit.id)).filter(Boolean) : [];
  const row: ImportRow = {
    line: 0,
    id: draft.id,
    subject: draft.subject.trim(),
    unit: draft.unit.trim() || '全般',
    section: draft.section.trim(),
    front: draft.front.trim(),
    back: draft.back.trim(),
    note: draft.note.trim(),
    tags: draft.tags.split(/\s+/).filter(Boolean),
  };
  const existing = useMemo(() => {
    const m = new Map<string, { card: CardData; subjectName: string }>();
    for (const c of d.cards) m.set(c.id, { card: c, subjectName: d.subjectName(c.s) });
    return m;
  }, [d]);
  const issues = validateRows([row], existing);
  const errors = issues.filter((i) => i.level === 'error');

  return (
    <div className="set-editor stack">
      <b>{draft.id ? 'カードを直す' : '新しいカード'}</b>
      <div className="row">
        <label className="field" style={{ flex: 1, minWidth: 120 }}>
          科目
          <input type="text" list="edit-subjects" value={draft.subject} onChange={(e) => set({ subject: e.target.value })} />
        </label>
        <label className="field" style={{ flex: 2, minWidth: 200 }}>
          セット
          <input type="text" list="edit-sets" value={draft.unit} onChange={(e) => set({ unit: e.target.value })} />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 120 }}>
          区分
          <input type="text" list="edit-sections" value={draft.section} onChange={(e) => set({ section: e.target.value })} />
        </label>
      </div>
      <datalist id="edit-subjects">
        {catalog.subjects.map((s) => (
          <option key={s.id} value={s.name} />
        ))}
      </datalist>
      <datalist id="edit-sets">
        {subject?.units.map((u) => <option key={u.id} value={u.name} />)}
      </datalist>
      <datalist id="edit-sections">
        {sections.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <label className="field">
        表（問題）
        <textarea rows={3} value={draft.front} onChange={(e) => set({ front: e.target.value })} />
      </label>
      <label className="field">
        裏（答え）
        <textarea rows={3} value={draft.back} onChange={(e) => set({ back: e.target.value })} />
      </label>
      <label className="field">
        解説（なくてもよい）
        <textarea rows={2} value={draft.note} onChange={(e) => set({ note: e.target.value })} />
      </label>
      <label className="field">
        タグ（空白で区切る）
        <input type="text" value={draft.tags} onChange={(e) => set({ tags: e.target.value })} />
      </label>
      {(draft.front || draft.back) && (
        <div className="preview">
          <div className="small muted">表示の確認</div>
          <Rich className="face" text={draft.front} />
          <hr className="divider" />
          <Rich className="face answer" text={draft.back} />
          {draft.note && <Rich className="note" text={draft.note} />}
        </div>
      )}
      {issues.length > 0 && (
        <ul className="issue-list">
          {issues.map((i, k) => (
            <li key={k}>
              <span className={`tag ${i.level}`}>{i.level === 'error' ? '要修正' : '要確認'}</span>
              {i.message}
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button className="btn primary" disabled={busy || errors.length > 0 || !row.subject} onClick={() => onSave(row)}>
          {draft.id ? '保存' : '追加'}
        </button>
        <button className="btn" onClick={() => setDraft(null)}>
          やめる
        </button>
        <span className="spacer" />
        {draft.id && (
          <button className="btn danger" disabled={busy} onClick={onDelete}>
            削除
          </button>
        )}
      </div>
    </div>
  );
}
