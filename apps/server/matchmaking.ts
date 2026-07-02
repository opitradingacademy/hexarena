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
   */
  join(entry: QueueEntry): [QueueEntry, QueueEntry] | null {
    const key = this.keyFor(entry);
    const bucket = this.queues.get(key) ?? [];

    const opponent = bucket.shift();
    if (opponent) {
      if (bucket.length === 0) this.queues.delete(key);
      else this.queues.set(key, bucket);
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
