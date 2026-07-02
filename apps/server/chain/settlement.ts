/**
 * Chain settlement adapter — STUB for PR2.
 *
 * The real implementation (PR3) will use a viem wallet client to call
 * `ArenaSettlement.settle(matchId, winner, amount)` on Celo Mainnet, per
 * design.md D1/D2 and arena-settlement spec "Settlement Idempotency Per
 * Match" / "Operator-Only Settlement Access". The contract does not exist
 * yet (packages/contracts is scaffolded only), so this mock logs the call
 * and returns a synthetic tx hash. Callers must treat the returned hash as
 * non-authoritative until PR3 wires the real signer.
 */

export type SettleOnChainResult = { txHash: string };

export async function settleOnChain(
  matchId: string,
  winner: string,
  amount: number,
): Promise<SettleOnChainResult> {
  // TODO(PR3): replace with viem call to ArenaSettlement.settle() once the
  // contract is deployed to Alfajores/Mainnet — see packages/contracts.
  const txHash = `0xmock${matchId.replace(/-/g, "").slice(0, 16).padEnd(16, "0")}`;
  console.log(
    `[settleOnChain:stub] matchId=${matchId} winner=${winner} amount=${amount} -> ${txHash}`,
  );
  return { txHash };
}
