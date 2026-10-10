import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api from "../../utils/api";
import Navbar from "../../components/Navbar";
import ManageHeader from "../../components/ManageHeader";
import { LoadingState } from "../../components/LoadingState";
import { SlidersHorizontal } from "lucide-react";

// All tools › Settings — the auction rules, editable by any admin. Saved
// values apply to the next auction created/started; a running one keeps its own.
export default function Settings() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const load = () => api.get("/settings/auction-rules").then((r) => { setData(r.data); setForm(r.data.rules); })
    .catch(() => toast.error("Couldn't load the settings"));
  useEffect(() => { load(); }, []);

  const changed = data ? Object.fromEntries(Object.entries(form).filter(([k, v]) => String(v) !== String(data.rules[k]))) : {};

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put("/admin/settings/auction-rules", changed);
      toast.success(res.data?.message || "Saved");
      setData({ ...data, rules: res.data.rules });
      setForm(res.data.rules);
    } catch (err) {
      toast.error(err.response?.data?.error || "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-ground">
      <Navbar />
      <ManageHeader hub="tools" subtitle="Auction rules. Changes apply to the next auction — a running one isn't affected." />
      <div className="max-w-xl mx-auto px-4 py-4">
        <div className="bg-white rounded-2xl shadow-soft p-4">
          <h2 className="font-black text-gray-900 mb-3 flex items-center gap-2"><SlidersHorizontal size={18} /> Auction rules</h2>
          {!data ? <LoadingState /> : (
            <>
              <div className="space-y-3">
                {data.fields.map((f) => (
                  <label key={f.key} className="block">
                    <span className="block text-sm font-bold text-gray-700">{f.label}</span>
                    <span className="flex items-center gap-2">
                      <input type="number" inputMode="decimal" className="input-field" min={f.min} max={f.max} step={f.step}
                        value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                      {String(form[f.key]) !== String(f.default) && (
                        <button type="button" onClick={() => setForm({ ...form, [f.key]: f.default })}
                          className="text-xs font-bold text-gray-500 whitespace-nowrap min-h-[44px] px-2">Reset to {f.default}</button>
                      )}
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-3">The five player groups and the release order stay as they are.</p>
              <button type="button" onClick={save} disabled={saving || Object.keys(changed).length === 0}
                className="btn-primary w-full mt-4 min-h-[48px] disabled:opacity-45">
                {saving ? "Saving…" : Object.keys(changed).length ? `Save ${Object.keys(changed).length} change${Object.keys(changed).length > 1 ? "s" : ""}` : "No changes"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
