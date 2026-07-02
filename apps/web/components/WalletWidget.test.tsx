// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WalletWidget } from "./WalletWidget";

describe("WalletWidget", () => {
  it("renders the balance in USD, never CELO/0x", () => {
    render(<WalletWidget balanceUSD={4.2} />);
    expect(screen.getByTestId("wallet-balance")).toHaveTextContent("$4.20");
  });

  it("renders a skeleton state while loading, not the balance", () => {
    render(<WalletWidget balanceUSD={4.2} loading />);
    expect(screen.getByTestId("wallet-widget-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("wallet-balance")).not.toBeInTheDocument();
  });
});
