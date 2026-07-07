/**
 * Truncates a 0x-prefixed address to the project's canonical display
 * form: `0x1234…5678` (6 hex chars + ellipsis + 4 hex chars).
 *
 * Used in any user-visible surface where a wallet address must be
 * rendered — MiniPay copy rules require addresses to never be shown
 * full-length, and the project's design system standardises on the
 * 6+4 form (see CLAUDE.md "Reglas de MiniPay").
 *
 * Falls back to returning the input as-is if it is shorter than the
 * minimum truncatable length (12 hex chars), so we never produce a
 * malformed display string for non-conforming inputs.
 */
export function shortenAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
