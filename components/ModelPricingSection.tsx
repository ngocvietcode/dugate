'use client';

// components/ModelPricingSection.tsx
// CRUD bảng giá model AIHub — nguồn giá để ƯỚC LƯỢNG chi phí cho provider chỉ trả token.
// Lưu vào AppSetting.model_pricing_json qua /api/settings/pricing.

import { useEffect, useState } from 'react';
import { Save, Loader2, Plus, Trash2, DollarSign, CheckCircle, XCircle } from 'lucide-react';

interface PricingRow {
  model: string;
  inputPer1M: number | string;
  outputPer1M: number | string;
}

export default function ModelPricingSection() {
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    fetch('/api/settings/pricing')
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d.rows) ? d.rows : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  const update = (i: number, field: keyof PricingRow, value: string) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, { model: '', inputPer1M: 0, outputPer1M: 0 }]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  async function save() {
    setSaving(true);
    setResult(null);
    // Client-side validation
    const seen = new Set<string>();
    for (const r of rows) {
      const model = String(r.model).trim();
      if (!model) { setResult({ ok: false, msg: 'Tên model không được để trống' }); setSaving(false); return; }
      if (seen.has(model)) { setResult({ ok: false, msg: `Model trùng lặp: ${model}` }); setSaving(false); return; }
      seen.add(model);
      if (Number(r.inputPer1M) < 0 || Number(r.outputPer1M) < 0 || !Number.isFinite(Number(r.inputPer1M)) || !Number.isFinite(Number(r.outputPer1M))) {
        setResult({ ok: false, msg: `Giá không hợp lệ cho model ${model}` }); setSaving(false); return;
      }
    }
    try {
      const payload = { rows: rows.map((r) => ({ model: String(r.model).trim(), inputPer1M: Number(r.inputPer1M), outputPer1M: Number(r.outputPer1M) })) };
      const res = await fetch('/api/settings/pricing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      setResult(res.ok ? { ok: true, msg: `Đã lưu ${data.count} model.` } : { ok: false, msg: data.error || 'Lỗi lưu bảng giá' });
    } catch {
      setResult({ ok: false, msg: 'Lỗi kết nối server' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modern-card p-6 md:p-8 space-y-5">
      <div className="flex items-center gap-2 border-b border-border pb-4">
        <DollarSign className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-bold text-foreground">Bảng giá Model — AIHub</h2>
      </div>

      <p className="text-sm text-muted-foreground">
        Đơn giá (USD trên <strong>1 triệu token</strong>) dùng để ước lượng chi phí cho các request qua AIHub
        (AIHub chỉ trả token, không trả tiền). Provider trả cost sẵn (Agent Studio/CAIP) sẽ dùng đúng giá trị đó, không áp bảng này.
        Ví dụ: input 0.15 &amp; output 0.60 → 1M token vào + 1M token ra = $0.75.
      </p>

      {loading ? (
        <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" /></div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="text-left font-medium py-2 pr-3">Model</th>
                  <th className="text-left font-medium py-2 px-3 w-40">Giá input (USD/1M)</th>
                  <th className="text-left font-medium py-2 px-3 w-40">Giá output (USD/1M)</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rows.length === 0 ? (
                  <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">Chưa có model nào. Bấm &quot;Thêm model&quot;.</td></tr>
                ) : rows.map((r, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        value={r.model}
                        onChange={(e) => update(i, 'model', e.target.value)}
                        placeholder="gemini-2.5-flash"
                        className="input-field font-mono text-sm"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="number" step="0.0001" min={0}
                        value={r.inputPer1M}
                        onChange={(e) => update(i, 'inputPer1M', e.target.value)}
                        className="input-field text-sm"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="number" step="0.0001" min={0}
                        value={r.outputPer1M}
                        onChange={(e) => update(i, 'outputPer1M', e.target.value)}
                        className="input-field text-sm"
                      />
                    </td>
                    <td className="py-2 text-center">
                      <button
                        onClick={() => removeRow(i)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                        title="Xoá"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={addRow}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
          >
            <Plus className="w-4 h-4" /> Thêm model
          </button>

          {result && (
            <div className={`flex items-center gap-2 text-sm font-medium rounded-xl px-4 py-3 ${result.ok ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-destructive/10 text-destructive border border-destructive/20'}`}>
              {result.ok ? <CheckCircle className="w-5 h-5 shrink-0" /> : <XCircle className="w-5 h-5 shrink-0" />}
              {result.msg}
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={save}
              disabled={saving}
              className="w-full sm:w-auto btn-primary modern-button py-2 px-5 text-sm"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Đang lưu...' : 'Lưu bảng giá'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
