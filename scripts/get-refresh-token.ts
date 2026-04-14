/**
 * Run this once to get a Google OAuth refresh token:
 *   npx tsx scripts/get-refresh-token.ts
 *
 * It will open your browser for Google sign-in, then print the refresh token.
 */
import { google } from "googleapis";
import http from "http";
import open from "open";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars first");
  process.exit(1);
}
const REDIRECT_URI = "http://localhost:3456/callback";

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/drive"],
});

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/callback")) return;

  const url = new URL(req.url, `http://localhost:3456`);
  const code = url.searchParams.get("code");

  if (!code) {
    res.end("No code received");
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log("\n=== YOUR REFRESH TOKEN ===");
    console.log(tokens.refresh_token);
    console.log("==========================\n");
    console.log("Add this to your docker-compose.yml env vars as GOOGLE_REFRESH_TOKEN");

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h1>Done!</h1><p>You can close this tab. Check the terminal for your refresh token.</p>");
  } catch (err) {
    console.error("Error getting token:", err);
    res.end("Error getting token");
  }

  setTimeout(() => process.exit(0), 1000);
});

server.listen(3456, () => {
  console.log("Opening browser for Google sign-in...");
  console.log("If it doesn't open, visit:", authUrl);
  open(authUrl);
});
