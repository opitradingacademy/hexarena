"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getSocket } from "../../../lib/socketSingleton";

/**
 * Invite-link landing screen. Opening this URL joins the sender directly
 * with whoever created the invite (see create_invite/join_invite in the
 * realtime protocol) — no queue, no matchmaking wait.
 */
export default function InvitePage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = params.code;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    function onMatchFound(payload: { matchId: string; color: "P1" | "P2"; opponent: string }) {
      router.push(
        `/game/${payload.matchId}?color=${payload.color}&opponent=${encodeURIComponent(
          payload.opponent,
        )}`,
      );
    }
    function onError(payload: { code: string }) {
      if (payload.code === "NOT_FOUND" || payload.code === "INVALID_STATE") {
        setError("This invite link is no longer valid.");
      } else if (payload.code === "INSUFFICIENT_BALANCE") {
        setError("You don't have enough balance to accept this stake.");
      }
    }

    socket.on("match_found", onMatchFound);
    socket.on("error", onError as never);
    socket.emit("join_invite", { code });

    return () => {
      socket.off("match_found", onMatchFound);
      socket.off("error", onError as never);
    };
  }, [code, router]);

  return (
    <main className="mx-auto flex max-w-md flex-col items-center px-4 pt-24 text-center">
      {error ? (
        <p role="alert" className="text-sm font-semibold text-arena-magenta">
          {error}
        </p>
      ) : (
        <>
          <div className="h-20 w-20 animate-spin rounded-full border-4 border-arena-cyan/20 border-t-arena-cyan" />
          <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-arena-cyan">
            Joining match…
          </p>
        </>
      )}
    </main>
  );
}
