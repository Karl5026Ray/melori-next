// src/lib/cloudflareCreds.ts
//
// Reads CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN the same way everywhere
// (moderation.ts and the /api/health probe), and cleans up the paste mistakes
// that broke moderation on 2026-09-24.
//
// That day the token was replaced twice in the Vercel dashboard, and both
// times Cloudflare answered 400 / code 9106 ("Authentication failed"). That
// is a malformed credential, not a wrong one (a wrong one gives 401 / 10000).
// Sensitive env vars can't be viewed after saving, so nobody could see what
// had actually been pasted. Copying a value out of chat or docs easily brings
// along wrapping quotes or backticks, a leading "Bearer ", or stray spaces.
//
// So this module:
//   * normalises: trims, and strips wrapping quotes/backticks and a leading
//     "Bearer " from both values;
//   * checks shape: the account ID must be 32 hex characters, and the token
//     must contain no whitespace. Problems are described WITHOUT echoing
//     either value, so /api/health can say what is wrong in public.

export type Env = Record<string, string | undefined>;

export interface CloudflareCreds {
  accountId: string;
  token: string;
  /** Human-readable shape problems. Never contains the values themselves. */
  problems: string[];
}

function clean(raw: string | undefined): string {
  let v = (raw ?? "").trim();
  // Strip one or more layers of wrapping quotes or backticks.
  for (;;) {
    const m = /^(["'`])([\s\S]*)\1$/.exec(v);
    if (!m) break;
    v = m[2].trim();
  }
  return v.replace(/^bearer\s+/i, "").trim();
}

export function readCloudflareCreds(env: Env): CloudflareCreds {
  const accountId = clean(env.CLOUDFLARE_ACCOUNT_ID);
  const token = clean(env.CLOUDFLARE_AI_TOKEN);
  const problems: string[] = [];

  if (!accountId) problems.push("CLOUDFLARE_ACCOUNT_ID is empty");
  else if (!/^[0-9a-f]{32}$/i.test(accountId)) {
    problems.push(
      `CLOUDFLARE_ACCOUNT_ID is not a 32-character hex ID (got ${accountId.length} characters)`,
    );
  }

  if (!token) problems.push("CLOUDFLARE_AI_TOKEN is empty");
  else if (/\s/.test(token)) {
    problems.push("CLOUDFLARE_AI_TOKEN contains spaces or line breaks (extra text was pasted with it)");
  } else if (!/^[A-Za-z0-9_\-]+$/.test(token)) {
    problems.push("CLOUDFLARE_AI_TOKEN contains characters a Cloudflare token never has");
  }

  return { accountId, token, problems };
}
