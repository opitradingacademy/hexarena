/**
 * Resolves the apps/server Socket.IO endpoint. Next.js only exposes env
 * vars prefixed `NEXT_PUBLIC_` to client bundles — see `.env.example`.
 */
export function getServerUrl(): string {
  return process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";
}
