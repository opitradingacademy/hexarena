// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StakeSelector } from "./StakeSelector";

describe("StakeSelector", () => {
  it("shows a 'Top up' hint under chips whose stake exceeds the balance", () => {
    render(<StakeSelector balanceUSD={0.2} selectedStake={null} onSelect={vi.fn()} />);
    // The chip's $0.50 cell shows the stake AND a 'Top up' hint,
    // rendered as a Button whose textContent includes both.
    expect(screen.getByTestId("stake-chip-0.5")).toHaveTextContent(/Top up/i);
    expect(screen.getByTestId("stake-chip-0.1")).not.toHaveTextContent(/Top up/i);
  });

  it("keeps chips within balance without the Top up hint and accepts a click", () => {
    const onSelect = vi.fn();
    render(<StakeSelector balanceUSD={5} selectedStake={null} onSelect={onSelect} />);
    expect(screen.getByTestId("stake-chip-0.25")).not.toHaveTextContent(/Top up/i);
    fireEvent.click(screen.getByTestId("stake-chip-0.25"));
    expect(onSelect).toHaveBeenCalledWith(0.25);
  });

  it("all chips are clickable even when the ledger cannot cover them — the matchmaking screen handles the rest", async () => {
    render(<StakeSelector balanceUSD={0} selectedStake={null} onSelect={vi.fn()} />);
    expect(screen.getByTestId("stake-chip-0.1")).toBeEnabled();
    expect(screen.getByTestId("stake-chip-1")).toBeEnabled();
  });
});
