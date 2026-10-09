import { useEffect, useState } from "react";
import api from "../utils/api";

// slot_id -> the two captains playing that match ([{ id, name, team_name }]),
// from the same /admin/overview the This week checklist uses. They run the
// draft and are never auctioned, so screens that count people by group must
// leave them out to match what the auction will actually see.
export function useMatchCaptains() {
  const [bySlot, setBySlot] = useState({});
  useEffect(() => {
    api.get("/admin/overview").then((res) => {
      const map = {};
      (res.data.matches || []).forEach((m) => { map[m.slot_id] = m.captains || []; });
      setBySlot(map);
    }).catch(() => {});
  }, []);
  return bySlot;
}
