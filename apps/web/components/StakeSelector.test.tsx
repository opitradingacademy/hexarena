// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StakeSelector } from "./StakeSelector";

describe("StakeSelector", () => {
  it("disables chips above the current balance and shows an 'Add funds' tooltip", () => {
    render(<StakeSelector balanceUSD={0.2} selectedStake={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "$0.50" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "$0.50" })).toHaveAttribute("title", "Add funds");
  });

  it("keeps chips within balance enabled", () => {
    render(<StakeSelector balanceUSD={0.2} selectedStake={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "$0.10" })).toBeEnabled();
  });

  it("calls onSelect with the numeric stake when an enabled chip is clicked", () => {
    const onSelect = vi.fn();
    render(<StakeSelector balanceUSD={5} selectedStake={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "$0.25" }));
    expect(onSelect).toHaveBeenCalledWith(0.25);
  });
});
