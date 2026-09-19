import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";

const clientId = process.env.TWITCH_CLIENT_ID;
const clientSecret = process.env.TWITCH_CLIENT_SECRET;
const redirectUri = process.env.TWITCH_REDIRECT_URI || "http://localhost:3000/callback";
const scope = "moderator:read:followers";

if (!clientId || !clientSecret) {
  console.error("Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET.");
  console.error("");
  console.error("PowerShell example:");
  console.error('$env:TWITCH_CLIENT_ID="..."');
  console.error('$env:TWITCH_CLIENT_SECRET="..."');
  console.error('node scripts/twitch/auth.mjs');
  process.exit(1);
}

const redirect = new URL(redirectUri);
if (redirect.hostname !== "localhost" && redirect.hostname !== "127.0.0.1") {
  console.error("This helper is intended for a localhost OAuth callback.");
  process.exit(1);
}

const state = crypto.randomBytes(24).toString("hex");

const authorizeUrl = new URL("https://id.twitch.tv/oauth2/authorize");
authorizeUrl.searchParams.set("client_id", clientId);
authorizeUrl.searchParams.set("redirect_uri", redirectUri);
authorizeUrl.searchParams.set("response_type", "code");
authorizeUrl.searchParams.set("scope", scope);
authorizeUrl.searchParams.set("state", state);
authorizeUrl.searchParams.set("force_verify", "true");

console.log("");
console.log("1. Make sure this exact redirect URL is registered in the Twitch app:");
console.log(`   ${redirectUri}`);
console.log("");
console.log("2. Open this URL in your browser and authorize with YOUR Twitch moderator account:");
console.log("");
console.log(authorizeUrl.toString());
console.log("");
console.log("Waiting for Twitch callback...");

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, redirectUri);

    if (requestUrl.pathname !== redirect.pathname) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found.");
      return;
    }

    const returnedState = requestUrl.searchParams.get("state");
    const code = requestUrl.searchParams.get("code");
    const error = requestUrl.searchParams.get("error");
    const errorDescription = requestUrl.searchParams.get("error_description");

    if (error) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`Twitch authorization failed: ${errorDescription || error}`);
      console.error("Authorization failed:", errorDescription || error);
      server.close();
      return;
    }

    if (!code || returnedState !== state) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Invalid OAuth callback.");
      console.error("Invalid callback or OAuth state.");
      server.close();
      return;
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });

    const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.status} ${await tokenResponse.text()}`);
    }

    const tokens = await tokenResponse.json();

    const validateResponse = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${tokens.access_token}` },
    });

    if (!validateResponse.ok) {
      throw new Error(`Token validation failed: ${validateResponse.status} ${await validateResponse.text()}`);
    }

    const validation = await validateResponse.json();

    const output = {
      created_at: new Date().toISOString(),
      user_id: validation.user_id,
      login: validation.login,
      scopes: validation.scopes,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      token_type: tokens.token_type,
    };

    await fs.writeFile(
      ".twitch-user-token.json",
      JSON.stringify(output, null, 2) + "\n",
      "utf8"
    );

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
      <!doctype html>
      <html>
        <body style="font-family:sans-serif;background:#111;color:#eee;padding:2rem">
          <h1>Twitch authorization complete</h1>
          <p>You can close this tab.</p>
          <p>The token was saved locally as <code>.twitch-user-token.json</code>.</p>
        </body>
      </html>
    `);

    console.log("");
    console.log("Authorization complete.");
    console.log(`Authorized Twitch account: ${validation.login} (${validation.user_id})`);
    console.log(`Scopes: ${(validation.scopes || []).join(", ")}`);
    console.log("");
    console.log("Saved: .twitch-user-token.json");
    console.log("DO NOT commit that file.");
    console.log("");
    console.log("Copy its refresh_token into the GitHub Actions secret:");
    console.log("TWITCH_USER_REFRESH_TOKEN");
    console.log("");

    server.close();
  } catch (err) {
    console.error(err);
    try {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Authorization failed. Check the terminal.");
    } catch {}
    server.close();
  }
});

server.listen(Number(redirect.port || 80), redirect.hostname, () => {});
