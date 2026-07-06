"use client";

import { useEffect } from "react";
import type { MoveRejectedReason } from "@hexarena/shared/protocol";

export type MoveRejectedToastProps = {
  /** Humanized rejection message, or null when no toast should be shown. */
  message: string | null;
  /** Called when the toast auto-dismisses (after 2500ms) or unmounts. */
  onDismiss: () => void;
};

/**
 * Non-blocking toast that surfaces `move_rejected` server events so users
 * understand why their click didn't register. Without this component, the
 * brief-disconnect bug (production 2026-07-06) manifested as a totally
 * silent failure — the user clicked a cell, the server rejected the move
 * because the client board was stale, and the rejection was invisible
 * because nothing listened to `move_rejected`.
 *
 * Auto-dismisses after 2500ms. Uses `role="status"` (not `role="alert"`)
 * because the board itself is the source of truth — the toast is purely
 * a UX nudge explaining why a click was rejected, not a blocking error.
 */
const AUTO_DISMISS_MS = 2500;

export function MoveRejectedToast({ message, onDismiss }: MoveRejectedToastProps) {
  useEffect(() => {
    if (!message) return;
    const handle = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(handle);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div
      data-testid="move-rejected-toast"
      role="status"
      className="fixed inset-x-0 bottom-24 z-40 mx-auto w-fit max-w-[90vw] rounded-xl border border-arena-magenta/60 bg-arena-bg/95 px-4 py-2 text-xs text-arena-magenta shadow-neonMagenta backdrop-blur"
    >
      {message}
    </div>
  );
}

/** Maps a server `MoveRejectedReason` to a short, user-friendly English string. */
export function humanizeMoveRejection(reason: MoveRejectedReason): string {
  switch (reason) {
    case "wrong-turn":
      return "It's not your turn yet";
    case "occupied":
      return "That cell is already taken";
    case "out-of-bounds":
      return "That's outside the board";
    case "no-capture":
      return "That move wouldn't capture any pieces";
    case "game-over":
      return "This match has ended";
  }
}
