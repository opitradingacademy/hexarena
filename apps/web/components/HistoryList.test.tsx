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

  it("truncates a full 0x wallet opponent to the 6+4 form so the row doesn't overflow", () => {
    render(
      <HistoryList
        entries={[
          {
            matchId: "m2",
            date: "2026-07-01",
            mode: "ARENA",
            opponentAlias: "0x34D5d015B4805E985619D0F4aaCb6343a6457fF2",
            result: "WIN",
            amountUSD: 0.08,
          },
        ]}
      />,
    );
    const row = screen.getByTestId("history-row-m2");
    expect(row).toHaveTextContent("0x34D5…7fF2");
    // Full address must NOT leak — copy rules + visual overflow both
    // depend on the truncation being applied.
    expect(row.textContent).not.toContain("0x34D5d015B4805E985619D0F4aaCb6343a6457fF2");
  });
});
