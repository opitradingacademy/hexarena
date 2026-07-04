// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MatchClock } from "./MatchClock";

describe("MatchClock", () => {
  it("renders a single formatted mm:ss shared clock", () => {
    render(<MatchClock matchClockMs={95_000} />);
    expect(screen.getByTestId("clock-value")).toHaveTextContent("01:35");
  });

  it("renders exactly one clock element, not one per player", () => {
    render(<MatchClock matchClockMs={95_000} />);
    expect(screen.getAllByTestId("match-clock")).toHaveLength(1);
  });

  it("flags low-time state below the 15s threshold", () => {
    render(<MatchClock matchClockMs={9_000} />);
    expect(screen.getByTestId("match-clock")).toHaveAttribute("data-low-time", "true");
  });
});
