// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlayerClock } from "./PlayerClock";

describe("PlayerClock", () => {
  it("renders the formatted mm:ss remaining time", () => {
    render(<PlayerClock label="You" remainingMs={95_000} isTurn />);
    expect(screen.getByTestId("clock-value")).toHaveTextContent("01:35");
  });

  it("shows 'Your turn' when isTurn is true and 'Opponent's turn' when false", () => {
    const { rerender } = render(<PlayerClock label="You" remainingMs={60_000} isTurn />);
    expect(screen.getByText("Your turn")).toBeInTheDocument();
    rerender(<PlayerClock label="You" remainingMs={60_000} isTurn={false} />);
    expect(screen.getByText("Opponent's turn")).toBeInTheDocument();
  });

  it("flags low-time state below the 15s threshold", () => {
    render(<PlayerClock label="You" remainingMs={9_000} isTurn />);
    expect(screen.getByTestId("player-clock")).toHaveAttribute("data-low-time", "true");
  });
});
