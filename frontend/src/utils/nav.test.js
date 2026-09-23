import { describe, it, expect } from "vitest";
import { tabsFor, tabKeyFor, hubsFor, homePathFor, REDIRECTS, HUBS } from "./nav";
import { crestColor, crestInitials } from "../components/TeamCrest";

const player = { role: "player" };
const captain = { role: "captain" };
const viewer = { role: "viewer" };
const organizer = { role: "organizer" };
const adminVoter = { role: "admin", is_player: true };
const captainAdmin = { role: "captain", is_admin: true };

const keys = (u) => tabsFor(u).map((t) => t.key);

describe("bottom tabs", () => {
  it("players and captains get Home · Matches · Auction · Stats · Me", () => {
    expect(keys(player)).toEqual(["home", "matches", "auction", "stats", "me"]);
    expect(keys(captain)).toEqual(["home", "matches", "auction", "stats", "me"]);
  });
  it("captains with admin rights keep Home and Auction, and get Manage instead of Stats", () => {
    expect(keys(captainAdmin)).toEqual(["home", "matches", "auction", "manage", "me"]);
    expect(keys(adminVoter)).toEqual(["home", "matches", "auction", "manage", "me"]);
  });
  it("read-only viewers see Matches, Stats and Me only", () => {
    expect(keys(viewer)).toEqual(["matches", "stats", "me"]);
  });
  it("never more than five tabs", () => {
    [player, captain, viewer, organizer, adminVoter, captainAdmin].forEach((u) => expect(tabsFor(u).length).toBeLessThanOrEqual(5));
  });
});

describe("tabKeyFor", () => {
  it("maps nested paths to their tab", () => {
    expect(tabKeyFor("/manage/players/attendance")).toBe("manage");
    expect(tabKeyFor("/auction/abc123")).toBe("auction");
    expect(tabKeyFor("/matches/whos-in")).toBe("matches");
    expect(tabKeyFor("/change-password")).toBe("me");
  });
});

describe("manage hubs", () => {
  it("hide the Duty roster from organizers (backend refuses them)", () => {
    const auctionSubs = (u) => hubsFor(u).find((h) => h.key === "auction").subs.map((s) => s.key);
    expect(auctionSubs(organizer)).toEqual(["run", "practice"]);
    expect(auctionSubs(captainAdmin)).toEqual(["run", "practice", "duty"]);
  });
  it("cover every old admin page", () => {
    const targets = new Set(HUBS.flatMap((h) => [h.to, ...h.subs.map((s) => s.to)]));
    ["/admin", "/admin/players", "/admin/attendance", "/admin/window", "/admin/tournament", "/admin/auction", "/admin/duty"]
      .forEach((old) => expect(targets.has(REDIRECTS[old])).toBe(true));
  });
});

describe("landing page", () => {
  it("sends staff to the Control Centre, voters Home, viewers to Matches", () => {
    expect(homePathFor(captainAdmin)).toBe("/manage");
    expect(homePathFor(organizer)).toBe("/manage");
    expect(homePathFor(captain)).toBe("/home");
    expect(homePathFor(player)).toBe("/home");
    expect(homePathFor(viewer)).toBe("/matches");
    expect(homePathFor(null)).toBe("/login");
  });
  it("redirects every pre-redesign player page", () => {
    expect(REDIRECTS["/captain/dashboard"]).toBe("/home");
    expect(REDIRECTS["/player/dashboard"]).toBe("/home");
    expect(REDIRECTS["/tournament"]).toBe("/matches");
    expect(REDIRECTS["/results"]).toBe("/matches/whos-in");
  });
});

describe("team crests", () => {
  it("uses two initials, ignoring a 'Demo' prefix", () => {
    expect(crestInitials("The Bomb Squad")).toBe("TB");
    expect(crestInitials("Demo Hawks")).toBe("HA");
    expect(crestInitials("Abhi11")).toBe("AB");
  });
  it("gives a team the same colour every time", () => {
    expect(crestColor("Viking Warriors")).toBe(crestColor("Viking Warriors"));
  });
});
