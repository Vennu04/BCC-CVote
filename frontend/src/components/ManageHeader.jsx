import { Link } from "react-router-dom";
import PageHeader from "./PageHeader";
import { useAuth } from "../context/AuthContext";
import { hubsFor } from "../utils/nav";

// Header for every Manage page: on phones a row of hub chips (Control
// Centre · Matches · Auction · Players — on laptops the sidebar does this),
// then the hub's title and its sub-tabs.
export default function ManageHeader({ hub, sub, subtitle, actions }) {
  const { user } = useAuth();
  const hubs = hubsFor(user);
  const current = hubs.find((h) => h.key === hub) || hubs[0];
  return (
    <PageHeader title={current.label} subtitle={subtitle} actions={actions} tabs={current.subs} active={sub}>
      <nav aria-label="Manage hubs" className="lg:hidden flex gap-1.5 overflow-x-auto scroll-touch -mx-1 px-1 pb-3 -mt-1">
        {hubs.map((h) => (
          <Link key={h.key} to={h.to} aria-current={h.key === hub ? "page" : undefined}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${
              h.key === hub ? "bg-brand-gold text-brand-navy" : "bg-white/10 text-white/75"}`}>
            {h.label}
          </Link>
        ))}
      </nav>
    </PageHeader>
  );
}
