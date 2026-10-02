import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import api from "../../utils/api";
import Navbar from "../../components/Navbar";
import ManageHeader from "../../components/ManageHeader";
import { LoadingState } from "../../components/LoadingState";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useConfirm } from "../../hooks/useConfirm";
import { Shield, Search } from "lucide-react";

// All tools › Admins — any admin can make someone an admin or take it away,
// so the app never needs a developer to change who runs it.
export default function Admins() {
  const [admins, setAdmins] = useState(null);
  const [people, setPeople] = useState([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(null);
  const { confirmProps, requestConfirm } = useConfirm();

  const load = () => {
    api.get("/admin/admins").then((r) => setAdmins(r.data)).catch(() => toast.error("Couldn't load admins"));
    api.get("/admin/players").then((r) => setPeople(r.data || [])).catch(() => {});
  };
  useEffect(load, []);

  const adminIds = new Set((admins || []).map((a) => a.id));
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return people.filter((p) => !adminIds.has(p.id) && (p.name.toLowerCase().includes(q) || (p.team_code || "").toLowerCase().includes(q))).slice(0, 8);
  }, [search, people, admins]); // eslint-disable-line react-hooks/exhaustive-deps

  const setAdmin = async (person, isAdmin) => {
    setBusy(person.id);
    try {
      const res = await api.put(`/admin/admins/${person.id}`, { is_admin: isAdmin });
      toast.success(res.data?.message || "Saved");
      setSearch("");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Couldn't change admin rights");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-brand-ground">
      <Navbar />
      <ManageHeader hub="tools" subtitle="Who can manage the app. Any admin can add or remove admins." />
      <div className="max-w-xl mx-auto px-4 py-4 space-y-3">
        <div className="bg-white rounded-2xl shadow-soft p-4">
          <h2 className="font-black text-gray-900 mb-2 flex items-center gap-2"><Shield size={18} /> Admins ({admins?.length ?? "…"})</h2>
          {!admins ? <LoadingState /> : (
            <ul className="divide-y divide-gray-100">
              {admins.map((a) => (
                <li key={a.id} className="flex items-center gap-2 py-2">
                  <span className="flex-1"><b className="text-gray-900">{a.name}</b> <span className="text-sm text-gray-500">· {a.team_code}</span></span>
                  {a.permanent ? <span className="text-xs text-gray-500">main login</span> : (
                    <button type="button" disabled={busy === a.id}
                      onClick={() => requestConfirm(`Take admin rights away from ${a.name}? They keep playing and voting as normal.`, () => setAdmin(a, false))}
                      className="min-h-[44px] px-3 rounded-xl bg-red-50 text-red-700 font-bold text-sm disabled:opacity-50">Remove</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-soft p-4">
          <h2 className="font-black text-gray-900 mb-1">Make someone an admin</h2>
          <p className="text-sm text-gray-600 mb-2">They can then run auctions, set up matches and manage players. Their login stays the same.</p>
          <label className="relative block">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input-field pl-9" placeholder="Type a name or login code" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <ul className="mt-2 divide-y divide-gray-100">
            {matches.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-2">
                <span className="flex-1"><b className="text-gray-900">{p.name}</b> <span className="text-sm text-gray-500">· {p.team_code}</span></span>
                <button type="button" disabled={busy === p.id}
                  onClick={() => requestConfirm(`Make ${p.name} an admin?`, () => setAdmin(p, true))}
                  className="min-h-[44px] px-3 rounded-xl bg-pitch-50 text-pitch-800 font-bold text-sm disabled:opacity-50">Make admin</button>
              </li>
            ))}
            {search.trim() && matches.length === 0 && <li className="py-2 text-sm text-gray-500">Nobody found.</li>}
          </ul>
        </div>
      </div>
      <ConfirmDialog {...confirmProps} />
    </div>
  );
}
