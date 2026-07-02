/**
 * Diagnostic breadcrumb state shared between page.tsx (producer) and
 * the on-screen DiagPanel (consumer). Mirrors the [HexArena:diag]
 * console.log entries emitted during the wallet/balance load.
 */
export type DiagEntry = {
  label: string;
  payload: string;
};

export function createDiagLog(): {
  entries: DiagEntry[];
  log: (label: string, payload: unknown) => void;
} {
  const entries: DiagEntry[] = [];
  return {
    entries,
    log(label: string, payload: unknown) {
      // Console mirror — DevTools users still see the breadcrumbs.
      console.log("[HexArena:diag]", label, payload ?? "");
      entries.push({ label, payload: stringify(payload) });
    },
  };
}

function stringify(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
