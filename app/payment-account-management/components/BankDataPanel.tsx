'use client';

// app/payment-account-management/components/BankDataPanel.tsx
// Input for `metadata.data` — the core-bank account data that mode=update
// reconciles the extracted MB03 against. Two tabs over ONE shared BankData state:
//
//   Form — three org name inputs + five people lists with add/remove rows. The
//          contract is small and fixed (3 scalars + 5 lists), and the backend
//          parser SILENTLY IGNORES unknown keys, so a typo'd key in raw JSON
//          produces zero checks with no error. The form makes that impossible.
//   JSON — for pasting a real core-bank payload from a ticket. Parsed on every
//          keystroke; invalid JSON is reported inline and does not clobber the
//          form state.

import React, { useState, useCallback } from 'react';
import type { BankData, BankPerson, BankPeopleListKey } from '../types';
import { BANK_PEOPLE_LISTS } from '../types';
import { ORG_FIELDS, pruneBankData } from './bank-data';
import { CopyButton } from './CopyButton';

interface BankDataPanelProps {
  value: BankData;
  onChange: (next: BankData) => void;
  /** Locks every input while a run is in flight. */
  disabled: boolean;
  /**
   * True when the current mode/stage combination actually sends this data
   * (update + e2e). When false the panel greys out and says why — otherwise a
   * tester fills it in and wonders why nothing was compared.
   */
  active: boolean;
  /** Bank data derived from a finished run's MB03, for the prefill button. */
  prefillSource?: BankData | null;
}

/** A realistic starting payload — every check has something to compare. */
const SAMPLE: BankData = {
  org_name_vi: 'CÔNG TY TNHH HƯNG ANH',
  org_name_foreign: 'HUNG ANH COMPANY LIMITED',
  org_short_name: 'HUNG ANH CO.,LTD',
  legal_representatives: [
    { full_name: 'NGUYỄN VĂN A', id_no: '038201005678', position: 'Giám đốc' },
  ],
  authorized_representatives: [],
  authorized_account_users: [],
  chief_accountants: [
    { full_name: 'PHẠM VĂN D', id_no: '038201002222', position: 'Kế toán trưởng' },
  ],
  authorized_by_chief_accountants: [],
};

const EMPTY_PERSON: BankPerson = { full_name: '', id_no: '', position: '' };

export function BankDataPanel({
  value,
  onChange,
  disabled,
  active,
  prefillSource,
}: BankDataPanelProps) {
  const [tab, setTab] = useState<'form' | 'json'>('form');
  // Raw JSON text is local to the JSON tab: we only push up to shared state when
  // it parses. Seeded from `value` each time the tab opens so the two views agree.
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const locked = disabled || !active;

  const openJsonTab = useCallback(() => {
    setJsonText(JSON.stringify(pruneBankData(value), null, 2));
    setJsonError(null);
    setTab('json');
  }, [value]);

  const handleJsonChange = useCallback((text: string) => {
    setJsonText(text);
    if (text.trim() === '') {
      setJsonError(null);
      onChange({});
      return;
    }
    try {
      const parsed = JSON.parse(text);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setJsonError('Phải là một JSON object (không phải mảng hoặc giá trị đơn).');
        return;
      }
      setJsonError(null);
      onChange(parsed as BankData);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : 'JSON không hợp lệ.');
    }
  }, [onChange]);

  const setOrg = (key: typeof ORG_FIELDS[number]['key'], v: string) => {
    onChange({ ...value, [key]: v });
  };

  const setPerson = (list: BankPeopleListKey, idx: number, field: keyof BankPerson, v: string) => {
    const rows = [...(value[list] ?? [])];
    rows[idx] = { ...rows[idx], [field]: v };
    onChange({ ...value, [list]: rows });
  };

  const addPerson = (list: BankPeopleListKey) => {
    onChange({ ...value, [list]: [...(value[list] ?? []), { ...EMPTY_PERSON }] });
  };

  const removePerson = (list: BankPeopleListKey, idx: number) => {
    const rows = (value[list] ?? []).filter((_, i) => i !== idx);
    onChange({ ...value, [list]: rows });
  };

  const applyPreset = (preset: BankData) => {
    onChange(preset);
    if (tab === 'json') setJsonText(JSON.stringify(pruneBankData(preset), null, 2));
    setJsonError(null);
  };

  const pruned = pruneBankData(value);
  const fieldCount = Object.keys(pruned).length;

  return (
    <div className={`modern-card p-5 space-y-4 ${!active ? 'opacity-60' : ''}`}>
      {/* Header: title + tabs */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-lg">🏦</div>
          <div>
            <h2 className="font-heading font-bold text-lg">Dữ liệu core bank</h2>
            <p className="text-muted-foreground text-xs">
              Gửi qua <code className="text-[10px] bg-muted px-1 rounded">metadata.data</code> — đối chiếu với MB03 đã trích xuất
            </p>
          </div>
        </div>
        <div className="flex gap-1 p-1 rounded-lg bg-muted/60">
          <button
            type="button"
            onClick={() => setTab('form')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
              tab === 'form' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Form
          </button>
          <button
            type="button"
            onClick={openJsonTab}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
              tab === 'json' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            JSON
          </button>
        </div>
      </div>

      {/* Why the panel is inert right now */}
      {!active && (
        <p className="text-[11px] text-amber-600 bg-amber-500/10 border border-amber-400/30 rounded-lg px-3 py-2 leading-snug">
          Chỉ dùng cho nghiệp vụ <strong>Cập nhật tài khoản</strong> ở stage <strong>E2E</strong>.
          Các stage khác bỏ qua dữ liệu này.
        </p>
      )}

      {/* The org checks are gated on an MB03 checkbox — say so up front, or three
          filled-in org names silently produce three `skip` rows. */}
      {active && (
        <p className="text-[11px] text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 leading-snug">
          ℹ️ Ba trường tên tổ chức chỉ được đối chiếu nếu MB03 có tick
          <strong> “Thay đổi tên tổ chức”</strong>; nếu không, kết quả sẽ là <em>skip</em>.
          Với 5 danh sách người: khớp theo <strong>(họ tên, số GTTT)</strong>, và chỉ
          <strong> chức vụ</strong> được so sánh.
        </p>
      )}

      {/* Presets */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => applyPreset(SAMPLE)}
          disabled={locked}
          className="modern-button btn-outline text-xs disabled:opacity-50"
        >
          Chèn mẫu
        </button>
        {prefillSource && (
          <button
            type="button"
            onClick={() => applyPreset(prefillSource)}
            disabled={locked}
            title="Lấy tên tổ chức + danh sách người từ MB03 vừa trích xuất, để sửa 1 giá trị và tạo fail có chủ đích"
            className="modern-button btn-outline text-xs disabled:opacity-50"
          >
            ↙ Lấy từ MB03 vừa chạy
          </button>
        )}
        <button
          type="button"
          onClick={() => applyPreset({})}
          disabled={locked}
          className="text-xs text-destructive hover:text-destructive/80 font-medium px-2 disabled:opacity-50"
        >
          Xóa hết
        </button>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {fieldCount === 0 ? 'Chưa có dữ liệu → BANK_DATA_MISSING' : `${fieldCount} nhóm trường sẽ được gửi`}
        </span>
      </div>

      {/* ── Form tab ────────────────────────────────────────────────────────── */}
      {tab === 'form' && (
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Mục 2 — Tên tổ chức hiện tại trên hệ thống
            </p>
            {ORG_FIELDS.map(f => (
              <label key={f.key} className="block">
                <span className="text-[11px] text-muted-foreground">{f.label}</span>
                <input
                  type="text"
                  value={value[f.key] ?? ''}
                  onChange={e => setOrg(f.key, e.target.value)}
                  disabled={locked}
                  placeholder={f.placeholder}
                  className="w-full mt-0.5 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
                />
              </label>
            ))}
          </div>

          <div className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Mục 4 — Danh sách người hiện tại trên hệ thống
            </p>
            {BANK_PEOPLE_LISTS.map(list => (
              <PeopleList
                key={list.key}
                section={list.section}
                label={list.label}
                rows={value[list.key] ?? []}
                disabled={locked}
                onAdd={() => addPerson(list.key)}
                onRemove={idx => removePerson(list.key, idx)}
                onChangeField={(idx, field, v) => setPerson(list.key, idx, field, v)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── JSON tab ────────────────────────────────────────────────────────── */}
      {tab === 'json' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              metadata.data
            </span>
            <CopyButton getText={() => jsonText} label="Copy" />
          </div>
          <textarea
            value={jsonText}
            onChange={e => handleJsonChange(e.target.value)}
            disabled={locked}
            spellCheck={false}
            rows={16}
            placeholder={'{\n  "org_name_vi": "...",\n  "chief_accountants": [\n    { "full_name": "...", "id_no": "...", "position": "..." }\n  ]\n}'}
            className={`w-full px-3 py-2.5 text-[11px] font-mono leading-relaxed bg-muted/40 border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50 ${
              jsonError ? 'border-destructive/60' : 'border-border'
            }`}
          />
          {jsonError ? (
            <p className="text-[11px] text-destructive leading-snug">⚠ {jsonError} — form vẫn giữ giá trị cũ.</p>
          ) : (
            <p className="text-[11px] text-muted-foreground leading-snug">
              Chỉ 8 key được backend đọc: <code className="text-[10px]">org_name_vi</code>,{' '}
              <code className="text-[10px]">org_name_foreign</code>,{' '}
              <code className="text-[10px]">org_short_name</code> và 5 danh sách người.
              Key khác bị <strong>bỏ qua âm thầm</strong>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── One people list (collapsible, add/remove rows) ─────────────────────────

interface PeopleListProps {
  section: string;
  label: string;
  rows: BankPerson[];
  disabled: boolean;
  onAdd: () => void;
  onRemove: (idx: number) => void;
  onChangeField: (idx: number, field: keyof BankPerson, value: string) => void;
}

function PeopleList({ section, label, rows, disabled, onAdd, onRemove, onChangeField }: PeopleListProps) {
  // Open by default when it already has rows, so a prefilled payload is visible
  // without five clicks.
  const [open, setOpen] = useState(rows.length > 0);

  return (
    <div className="border border-border/60 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
      >
        <span className="text-[10px] font-mono text-muted-foreground w-8">{section}</span>
        <span className="text-xs font-medium flex-1">{label}</span>
        {rows.length > 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
            {rows.length}
          </span>
        )}
        <span className="text-xs text-muted-foreground">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2">
          {rows.length === 0 && (
            <p className="text-[11px] text-muted-foreground italic">Chưa có người nào — danh sách này sẽ không được gửi.</p>
          )}
          {rows.map((p, idx) => (
            <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
              <input
                type="text"
                value={p.full_name ?? ''}
                onChange={e => onChangeField(idx, 'full_name', e.target.value)}
                disabled={disabled}
                placeholder="Họ và tên"
                className="px-2 py-1.5 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
              />
              <input
                type="text"
                value={p.id_no ?? ''}
                onChange={e => onChangeField(idx, 'id_no', e.target.value)}
                disabled={disabled}
                placeholder="Số GTTT"
                className="px-2 py-1.5 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
              />
              <input
                type="text"
                value={p.position ?? ''}
                onChange={e => onChangeField(idx, 'position', e.target.value)}
                disabled={disabled}
                placeholder="Chức vụ (được so sánh)"
                className="px-2 py-1.5 text-xs bg-background border border-primary/30 rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => onRemove(idx)}
                disabled={disabled}
                className="p-1.5 hover:bg-destructive/10 rounded-md text-muted-foreground hover:text-destructive text-xs disabled:opacity-50"
                aria-label="Xóa dòng"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={onAdd}
            disabled={disabled}
            className="text-[11px] text-primary hover:underline font-medium disabled:opacity-50"
          >
            + Thêm người
          </button>
        </div>
      )}
    </div>
  );
}
