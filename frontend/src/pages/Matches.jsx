import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import api from "../utils/api";
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
  // Team and group counts come from the tournament itself, so the header
  // stays right when teams are added (it used to say "27 teams" forever).
  const [meta, setMeta] = useState(null);
  useEffect(() => {
    api.get("/tournament/teams").then((r) => {
      const teams = Array.isArray(r.data) ? r.data : r.data.teams || [];
      setMeta({ teams: teams.length, groups: new Set(teams.map((t) => t.group)).size });
    }).catch(() => {});
  }, []);
  const subtitle = [TOURNAMENT_NAME, meta && `${meta.teams} teams`, meta && `${meta.groups} groups`, "20 overs · hard tennis ball"].filter(Boolean).join(" · ");
  return (
    <div className="min-h-screen bg-brand-ground">
      <Navbar />
      <PageHeader title="Matches" subtitle={subtitle} tabs={TABS} active={active} />
      <div className="max-w-5xl mx-auto px-4 py-4">
        {active === "whos-in" ? <WhosInView /> : <TournamentView view={active} />}
      </div>
    </div>
  );
}
