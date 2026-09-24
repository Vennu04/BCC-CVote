import { Link } from "react-router-dom";
import PageHeader from "./PageHeader";
import { useAuth } from "../context/AuthContext";
import { hubsFor, manageTopFor } from "../utils/nav";

// Header for every Manage page: on phones two chips — This week (the guided
// checklist) and All tools (everything else; on laptops the sidebar does
// this) — then the page title and its sub-tabs.
export default function ManageHeader({ hub, sub, subtitle, actions, title }) {
  const { user } = useAuth();
  const hubs = hubsFor(user);
  const current = hubs.find((h) => h.key === hub) || hubs[0];
  const top = hubs.filter((h) => h.key === "control" || h.key === "tools");
  const topActive = manageTopFor(hub);
  return (
    <PageHeader title={title || current.label} subtitle={subtitle} actions={actions} tabs={current.subs} active={sub}>
      <nav aria-label="Manage hubs" className="lg:hidden flex gap-1.5 overflow-x-auto scroll-touch -mx-1 px-1 pb-3 -mt-1">
        {top.map((h) => (
          <Link key={h.key} to={h.to} aria-current={h.key === topActive ? "page" : undefined}
            className={`shrink-0 rounded-full px-4 min-h-[36px] inline-flex items-center text-sm font-bold ${
              h.key === topActive ? "bg-brand-gold text-brand-navy" : "bg-white/10 text-white/80"}`}>
            {h.label}
          </Link>
        ))}
      </nav>
    </PageHeader>
  );
}
