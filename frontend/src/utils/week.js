// "This week" checklist — the 8 guided steps an admin walks through for one
// match, worked out from /admin/overview plus two things only this browser
// knows (who sits out of an odd category, and whether the teams were already
// copied for WhatsApp). Pure functions so the rules are unit-tested.

export const STEP_KEYS = ["setup", "votes", "close", "attend", "odd", "duty", "start", "share"];

export const STEP_TITLES = {
  setup: "Set up the match",
  votes: "Watch the votes",
  close: "Close voting",
  attend: "Credit attendance",
  odd: "Fix odd numbers",
  duty: "Confirm who runs it",
  start: "Start the auction",
  share: "Share the teams",
};

const GROUP_NAMES = {
  extra_power_allrounder: "EP All-rounders",
  extra_power_batsman: "EP Batsmen",
  power: "Power",
  classic: "Classic",
};
export const groupName = (g) => GROUP_NAMES[g] || g;

// Per-browser memory, keyed by match.
const sitOutKey = (slotId) => `bcc_sitouts_${slotId}`;
const sharedKey = (slotId) => `bcc_teams_shared_${slotId}`;
const read = (k, fallback) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: step just won't remember */ } };

export const getSitOuts = (slotId) => read(sitOutKey(slotId), {});
export const setSitOut = (slotId, group, userId) => write(sitOutKey(slotId), { ...getSitOuts(slotId), [group]: userId });
export const clearSitOut = (slotId, group) => { const s = getSitOuts(slotId); delete s[group]; write(sitOutKey(slotId), s); };
export const wasShared = (slotId) => read(sharedKey(slotId), false) === true;
export const markShared = (slotId) => write(sharedKey(slotId), true);

// Odd categories that still have nobody chosen to sit out.
export function unresolvedOdd(match, sitOuts = {}) {
  return (match?.odd_groups || []).filter((g) => !sitOuts[g]);
}

// Voting state helpers from /admin/overview's match.voting.state.
const votingClosed = (m) => m.voting?.state === "closed" || !!m.auction;

export function computeSteps(match, { sitOuts = {}, shared = false } = {}) {
  const c = match.counts || {};
  const auction = match.auction?.status || null;
  const closed = votingClosed(match);
  const odd = unresolvedOdd(match, sitOuts);
  const credited = auction === "completed" || (c.available > 0 && match.attendance_credited >= c.available);
  const dutyDone = !match.is_weekend || !!match.duty?.lead_id;

  const steps = {
    setup: { done: true, detail: `${match.label} · ${match.kickoff || ""}`.trim() },
    votes: {
      done: closed || c.yet_to_vote === 0,
      detail: `${c.available ?? 0} playing · ${c.not_available ?? 0} not · ${c.yet_to_vote ?? 0} haven't said`,
      lock: match.voting?.state === "scheduled" ? "Voting hasn't opened yet" : null,
    },
    close: {
      done: closed,
      detail: closed ? "Voting closed" : "Do this before the auction evening",
      lock: match.voting?.state === "scheduled" ? "Voting hasn't opened yet" : null,
    },
    attend: {
      done: credited,
      detail: credited ? `${match.attendance_credited} players credited` : `+1 for the ${c.available ?? 0} who are playing`,
      lock: closed ? null : "Close voting first",
    },
    odd: {
      done: closed && odd.length === 0,
      detail: odd.length ? `${odd.map(groupName).join(", ")} ${odd.length > 1 ? "are" : "is"} odd` : "All groups even",
      lock: closed ? null : "Close voting first",
    },
    duty: {
      done: dutyDone,
      detail: !match.is_weekend ? "Weekday match — the Organiser runs it"
        : match.duty?.lead_id ? "Lead and Backup confirmed" : "Pick a Lead and a Backup",
    },
    start: {
      done: auction === "completed",
      detail: { null: "Pick captains, share the player list, start", pending: "Waiting for the captains · player list ready", active: "The auction is live", completed: "Auction finished" }[auction],
      lock: !closed ? "Close voting first" : odd.length ? "Fix odd numbers first" : null,
    },
    share: {
      done: auction === "completed" && shared,
      detail: shared ? "Teams copied for WhatsApp" : "Copy both teams to the group",
      lock: auction === "completed" ? null : "Finish the auction first",
    },
  };

  const list = STEP_KEYS.map((key, i) => ({ key, n: i + 1, title: STEP_TITLES[key], ...steps[key] }));
  const next = list.find((s) => !s.done && !s.lock);
  return list.map((s) => ({ ...s, state: s.done ? "done" : s === next ? "now" : s.lock ? "locked" : "open" }));
}

// The match to show first: the soonest one that still has work left.
export function defaultMatch(matches, extras = () => ({})) {
  return matches.find((m) => computeSteps(m, extras(m.slot_id)).some((s) => !s.done)) || matches[0] || null;
}
