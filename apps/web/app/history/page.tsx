"use client";

import { useState } from "react";
import { HistoryList, type HistoryEntry } from "../../components/HistoryList";

/**
 * History screen (design.md wireframe "4. Result / History").
 * Real match history fetch from apps/server's read endpoint (task 2.14)
 * is wired in PR5 e2e; local state here is a placeholder for the list shape.
 */
export default function HistoryPage() {
  const [filter, setFilter] = useState<"ALL" | "CASUAL" | "ARENA">("ALL");
  const [entries] = useState<HistoryEntry[]>([]);

  const filtered = entries.filter((e) => filter === "ALL" || e.mode === filter);

  return (
    <main>
      <h2>History</h2>
      <div>
        <button type="button" onClick={() => setFilter("ALL")}>
          All
        </button>
        <button type="button" onClick={() => setFilter("CASUAL")}>
          Casual
        </button>
        <button type="button" onClick={() => setFilter("ARENA")}>
          Arena
        </button>
      </div>
      <HistoryList entries={filtered} />
    </main>
  );
}
