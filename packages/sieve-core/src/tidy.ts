const SHORT = /^\/shorts\/([A-Za-z0-9_-]{11})\/?$/;

// An absolute https://www.youtube.com/shorts/<id> address (any query) becomes the watch address; anything else is null.
export function shortsToWatch(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const id = u.protocol === 'https:' && u.hostname === 'www.youtube.com' ? SHORT.exec(u.pathname)?.[1] : undefined;
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}
