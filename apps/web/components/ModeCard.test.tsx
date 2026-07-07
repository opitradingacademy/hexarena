// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ModeCard } from "./ModeCard";

describe("ModeCard", () => {
  it("shows a 'Play now' action for the Casual mode", () => {
    render(<ModeCard mode="CASUAL" balanceUSD={0} />);
    expect(screen.getByRole("button", { name: "Play now" })).toBeInTheDocument();
  });

  it("enables 'Play for real' for Arena when balance is positive", () => {
    render(<ModeCard mode="ARENA" balanceUSD={4.2} />);
    expect(screen.getByRole("button", { name: "Play for real" })).toBeEnabled();
  });

  it("disables Arena play and prompts to add funds when balance is zero", () => {
    render(<ModeCard mode="ARENA" balanceUSD={0} />);
    expect(screen.getByRole("button", { name: "Add funds to play" })).toBeDisabled();
  });

  it("shows a 'Pay to play' badge on Arena (parity with Casual 'Free')", () => {
    render(<ModeCard mode="ARENA" balanceUSD={1} />);
    expect(screen.getByTestId("mode-card-arena-badge")).toHaveTextContent("Pay to play");
  });

  it("shows the stake range on Arena so the user knows what they're paying", () => {
    render(<ModeCard mode="ARENA" balanceUSD={1} />);
    expect(screen.getByTestId("mode-card-arena")).toHaveTextContent("$0.10–$1 stake");
  });
});
