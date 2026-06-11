// One-time helper to turn a Meta OAuth code into a long-lived Threads token.
//   npm run token:url        -> prints the authorization URL to open
//   npm run token -- <code>  -> exchanges the code for a long-lived (~60 day) token
//
// Needs THREADS_CLIENT_ID, THREADS_CLIENT_SECRET, THREADS_REDIRECT_URI in .env.

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env"), quiet: true });

const SCOPES = "threads_basic,threads_content_publish,threads_manage_replies";

function need(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    console.error(`Missing ${name} in .env`);
    process.exit(1);
  }
  return v;
}

const arg = process.argv[2];

if (!arg || arg === "--url") {
  const clientId = need("THREADS_CLIENT_ID");
  const redirectUri = need("THREADS_REDIRECT_URI");
  const url =
    "https://threads.net/oauth/authorize" +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    "&response_type=code";
  console.log("\n1) Open this URL, sign in as @mdnoteslab, and approve:\n");
  console.log(url);
  console.log(
    "\n2) You'll land on your redirect URI with ?code=... in the address bar." +
      "\n   Copy the code (drop any trailing #_), then run:\n   npm run token -- <code>\n",
  );
} else {
  const clientId = need("THREADS_CLIENT_ID");
  const clientSecret = need("THREADS_CLIENT_SECRET");
  const redirectUri = need("THREADS_REDIRECT_URI");
  const code = arg.replace(/#_$/, "").trim();

  const shortRes = await fetch("https://graph.threads.net/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }).toString(),
  });
  const shortJson = (await shortRes.json()) as { access_token?: string };
  if (!shortRes.ok || !shortJson.access_token) {
    console.error("Short-token exchange failed:", JSON.stringify(shortJson));
    process.exit(1);
  }

  const longUrl =
    "https://graph.threads.net/access_token" +
    "?grant_type=th_exchange_token" +
    `&client_secret=${encodeURIComponent(clientSecret)}` +
    `&access_token=${encodeURIComponent(shortJson.access_token)}`;
  const longRes = await fetch(longUrl);
  const longJson = (await longRes.json()) as { access_token?: string; expires_in?: number };
  if (!longRes.ok || !longJson.access_token) {
    console.error("Long-token exchange failed:", JSON.stringify(longJson));
    process.exit(1);
  }

  const days = Math.round((longJson.expires_in ?? 0) / 86400);
  console.log(`\nDone. Paste this into .env as THREADS_ACCESS_TOKEN= (valid ~${days} days):\n`);
  console.log(longJson.access_token);
  console.log("");
}
