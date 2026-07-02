// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiagPanel } from "./DiagPanel";

describe("DiagPanel", () => {
  it("renders nothing when there are no entries", () => {
    const { container } = render(<DiagPanel entries={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one line per entry with the form [label] payload", () => {
    render(
      <DiagPanel
        entries={[
          { label: "A.isMiniPay", payload: JSON.stringify({ isMiniPay: true }) },
          { label: "C.balance", payload: JSON.stringify({ balance: 1.5 }) },
        ]}
      />,
    );
    const pre = screen.getByTestId("diag-panel").querySelector("pre");
    expect(pre?.textContent).toBe('[A.isMiniPay] {"isMiniPay":true}\n[C.balance] {"balance":1.5}');
  });
});
