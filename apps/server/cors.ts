/**
 * CORS for the apps/server HTTP handler. The Socket.IO layer already has
 * its own `cors: { origin: '*' }`, but the plain HTTP endpoints (/api/deposit,
 * /matches/:userId, ...) go through httpServer.on('request', ...) and
 * inherit Node's default behaviour: NO Access-Control-Allow-Origin header
 * at all. The MiniPay WebView blocks POSTs without those headers when the
 * page origin differs from the server origin (Vercel vs Railway).
 *
 * The Mini App runs on Vercel (https://web-taupe-alpha-23.vercel.app) and
 * the API is on Railway (https://hexarenaserver-production.up.railway.app),
 * so CORS preflight from the WebView's fetch() would otherwise block the
 * /api/deposit POST. Setting origin to '*' is the MVP-acceptable fix;
 * tightening to the deployed Vercel URL is a follow-up if we want to
 * expose this server beyond the hexarena Mini App.
 */
export function applyCorsHeaders(
  headers: Record<string, string | string[] | undefined>,
  origin: string | "*",
): void {
  headers["Access-Control-Allow-Origin"] = origin;
  headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
  headers["Access-Control-Allow-Headers"] = "content-type, x-wallet-address, idempotency-key";
  headers["Access-Control-Max-Age"] = "86400";
}
