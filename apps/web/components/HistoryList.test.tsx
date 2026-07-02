// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HistoryList } from "./HistoryList";

describe("HistoryList", () => {
  it("shows the empty-state copy when there are no matches", () => {
    render(<HistoryList entries={[]} />);
    expect(screen.getByTestId("history-empty")).toHaveTextContent(
      "No matches yet — play your first game.",
    );
  });

  it("renders a row per entry with a signed USD amount", () => {
    render(
      <HistoryList
        entries={[
          {
            matchId: "m1",
            date: "2026-07-01",
            mode: "ARENA",
            opponentAlias: "alice",
            result: "WIN",
            amountUSD: 0.9,
          },
        ]}
      />,
    );
    expect(screen.getByTestId("history-row-m1")).toHaveTextContent("+$0.90");
    expect(screen.getByTestId("history-row-m1")).toHaveTextContent("alice");
  });
});
