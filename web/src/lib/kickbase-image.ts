/**
 * Kickbase serves player/manager photos as relative paths (e.g.
 * "content/file/<hash>.png", "user/<hash>.jpe") off this CDN - confirmed
 * live with real paths from this account's own squad/market/ranking data
 * (200 responses, real image bytes), not guessed from documentation.
 */
const KICKBASE_IMAGE_BASE = "https://kickbase.b-cdn.net/";

export function kickbaseImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith("http") ? path : `${KICKBASE_IMAGE_BASE}${path}`;
}
