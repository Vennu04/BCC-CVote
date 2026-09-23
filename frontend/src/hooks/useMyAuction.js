import { useEffect, useState } from "react";
import api from "../utils/api";
import { useAuth } from "../context/AuthContext";

const POLL_MS = 10000;

// The live auction this voter is part of (as a captain or pool player), or
// null. Polled so "an auction just went live" surfaces on every screen —
// the Auction tab's red dot and Home's live banner — without a shared link.
export function useMyAuction() {
  const { user, isVoter } = useAuth();
  const [auctionId, setAuctionId] = useState(null);

  useEffect(() => {
    if (!user || !isVoter) return;
    let cancelled = false;
    const check = () => {
      api.get("/auction/my-active")
        .then((res) => { if (!cancelled) setAuctionId(res.data?.auction_id || null); })
        .catch(() => {});
    };
    check();
    const interval = setInterval(check, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user, isVoter]);

  return auctionId;
}
