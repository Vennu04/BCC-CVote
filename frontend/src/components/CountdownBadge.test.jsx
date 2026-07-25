import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import CountdownBadge from "./CountdownBadge";

// Regression coverage for the NaN:NaN bug this component's own comment
// documents: it must be fed a real parseable ISO deadline (endsAtIso), never
// the human-readable IST display string ("ends_at") -- new Date() silently
// produces NaN on that and the badge used to show "NaN:NaN left".
describe("CountdownBadge", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when no deadline is given", () => {
    const { container } = render(<CountdownBadge endsAtIso={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("counts down cleanly (never NaN) for a future ISO deadline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T10:00:00.000Z"));
    render(<CountdownBadge endsAtIso="2026-08-15T10:02:05.000Z" />);
    expect(screen.getByText("02:05 left")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("shows Time's up once the deadline has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T10:05:00.000Z"));
    render(<CountdownBadge endsAtIso="2026-08-15T10:00:00.000Z" />);
    expect(screen.getByText("Time's up")).toBeInTheDocument();
  });
});
