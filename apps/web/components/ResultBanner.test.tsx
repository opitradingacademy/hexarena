// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResultBanner } from "./ResultBanner";

describe("ResultBanner", () => {
  it("shows WIN and the Arena prize line when the self player wins", () => {
    render(
      <ResultBanner
        selfPlayer="P1"
        result={{ winner: "P1", reason: "majority", arena: { prizeUSD: 0.9, settleTxPending: false } }}
      />,
    );
    expect(screen.getByText("WIN")).toBeInTheDocument();
    expect(screen.getByText("You won $0.90")).toBeInTheDocument();
    expect(screen.getByText("Payout sent")).toBeInTheDocument();
  });

  it("shows LOSE for a Casual match with no arena block (no prize line)", () => {
    render(<ResultBanner selfPlayer="P2" result={{ winner: "P1", reason: "timeout" }} />);
    expect(screen.getByText("LOSE")).toBeInTheDocument();
    expect(screen.getByText("Time out")).toBeInTheDocument();
    expect(screen.queryByTestId("arena-prize")).not.toBeInTheDocument();
  });

  it("shows DRAW when winner is null", () => {
    render(<ResultBanner selfPlayer="P1" result={{ winner: null, reason: "draw" }} />);
    expect(screen.getByText("DRAW")).toBeInTheDocument();
  });
});
