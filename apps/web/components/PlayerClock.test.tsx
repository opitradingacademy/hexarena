// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlayerClock } from "./PlayerClock";

describe("PlayerClock", () => {
  it("renders the formatted mm:ss remaining time", () => {
    render(<PlayerClock label="You" remainingMs={95_000} isTurn isSelf />);
    expect(screen.getByTestId("clock-value")).toHaveTextContent("01:35");
  });

  it("labels the turn from this row's own perspective, never claiming the other player's turn", () => {
    const { rerender } = render(<PlayerClock label="You" remainingMs={60_000} isTurn isSelf />);
    expect(screen.getByText("Your turn")).toBeInTheDocument();

    rerender(<PlayerClock label="You" remainingMs={60_000} isTurn={false} isSelf />);
    expect(screen.getByText("Waiting…")).toBeInTheDocument();

    rerender(<PlayerClock label="Opponent" remainingMs={60_000} isTurn isSelf={false} />);
    expect(screen.getByText("Opponent's turn")).toBeInTheDocument();

    rerender(<PlayerClock label="Opponent" remainingMs={60_000} isTurn={false} isSelf={false} />);
    expect(screen.getByText("Waiting…")).toBeInTheDocument();
  });

  it("flags low-time state below the 15s threshold", () => {
    render(<PlayerClock label="You" remainingMs={9_000} isTurn isSelf />);
    expect(screen.getByTestId("player-clock")).toHaveAttribute("data-low-time", "true");
  });
});
