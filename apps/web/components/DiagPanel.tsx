import type { DiagEntry } from "../lib/diag";

export type DiagPanelProps = {
  entries: DiagEntry[];
};

/**
 * Diagnostic panel rendered on-screen (visible to the user) so the build
 * can be inspected without attaching DevTools. Used to capture the
 * MiniPay wallet/balance failure mode from a physical device when USB
 * remote debugging isn't an option. Same data also gets console.log'd
 * for the DevTools flow.
 */
export function DiagPanel({ entries }: DiagPanelProps) {
  if (entries.length === 0) return null;

  return (
    <details
      data-testid="diag-panel"
      open
      className="mt-6 rounded-xl border border-arena-gold/40 bg-black/80 p-3 text-left font-mono text-[10px] text-arena-gold"
    >
      <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide">
        Diag ({entries.length})
      </summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">
        {entries.map((e) => `[${e.label}] ${e.payload}`).join("\n")}
      </pre>
    </details>
  );
}
