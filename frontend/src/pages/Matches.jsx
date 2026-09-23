import { useLocation } from "react-router-dom";
import Navbar from "../components/Navbar";
import PageHeader from "../components/PageHeader";
import { TournamentView } from "./Tournament";
import { WhosInView } from "./Results";
import { TOURNAMENT_NAME } from "../config/appMeta";

const TABS = [
  { key: "fixtures", label: "Fixtures", to: "/matches" },
  { key: "groups", label: "Groups", to: "/matches/groups" },
  { key: "whos-in", label: "Who's in", to: "/matches/whos-in" },
];

// Matches tab — the old Tournament and Results pages as three sub-tabs.
export default function Matches() {
  const { pathname } = useLocation();
  const active = pathname.endsWith("/groups") ? "groups" : pathname.endsWith("/whos-in") ? "whos-in" : "fixtures";
  return (
    <div className="min-h-screen bg-brand-ground">
      <Navbar />
      <PageHeader title="Matches" subtitle={`${TOURNAMENT_NAME} · 27 teams · 3 groups · 20 overs · hard tennis ball`} tabs={TABS} active={active} />
      <div className="max-w-5xl mx-auto px-4 py-4">
        {active === "whos-in" ? <WhosInView /> : <TournamentView view={active} />}
      </div>
    </div>
  );
}
