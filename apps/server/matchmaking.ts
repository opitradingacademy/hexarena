/**
 * Matchmaking queue — pairs compatible clients (mode + stake).
 * Spec: realtime-protocol "Queue Join", "Match Found".
 */
import type { GameMode } from "@hexarena/shared/protocol";

export type QueueEntry = {
  userId: string;
  mode: GameMode;
  stake?: number;
};

export class Matchmaker {
  private queues = new Map<string, QueueEntry[]>();

  private keyFor(entry: Pick<QueueEntry, "mode" | "stake">): string {
    return entry.mode === "ARENA" ? `ARENA:${entry.stake}` : "CASUAL";
  }

  /**
   * Joins the queue and returns a pairing if a compatible opponent was
   * already waiting, otherwise null (caller stays queued).
   *
   * Never pairs a user with themselves — if the only waiting entry is
   * the same userId (e.g. the user reconnected with the same wallet
   * and their previous entry wasn't cancelled), keep them queued.
   */
  join(entry: QueueEntry): [QueueEntry, QueueEntry] | null {
    const key = this.keyFor(entry);
    const bucket = this.queues.get(key) ?? [];

    // Find the oldest queued opponent whose userId is NOT the same as
    // the joiner. Skip self-entries silently — they're left in the
    // bucket for a future, distinct reconnect to consume (or be
    // cancelled by an explicit cancel_queue).
    const idx = bucket.findIndex((e) => e.userId !== entry.userId);
    if (idx >= 0) {
      const [opponent] = bucket.splice(idx, 1);
      if (bucket.length === 0) this.queues.delete(key);
      else this.queues.set(key, bucket);
      // Preserve queue order: the joiner is now P2 (later in time),
      // the waiting opponent is P1.
      return [opponent, entry];
    }

    bucket.push(entry);
    this.queues.set(key, bucket);
    return null;
  }

  cancel(userId: string): boolean {
    for (const [key, bucket] of this.queues) {
      const idx = bucket.findIndex((e) => e.userId === userId);
      if (idx >= 0) {
        bucket.splice(idx, 1);
        if (bucket.length === 0) this.queues.delete(key);
        else this.queues.set(key, bucket);
        return true;
      }
    }
    return false;
  }
}
