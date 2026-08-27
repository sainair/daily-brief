/**
 * One-time helper: run this locally to obtain a Gmail API refresh token for
 * GMAIL_REFRESH_TOKEN. Requires GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET to
 * already be set (in .env or the environment), from a Google Cloud OAuth
 * "Desktop app" client. See README.md for the full setup steps.
 */
import "dotenv/config";
import * as http from "http";
import { exec } from "child_process";
import { google } from "googleapis";

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

async function main() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET (e.g. in a .env file) before running this script.");
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/gmail.send"],
  });

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "", REDIRECT_URI);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      res.end(error ? "Authorization failed. You can close this tab." : "Authorization received. You can close this tab.");
      server.close();
      if (error) reject(new Error(error));
      else if (code) resolve(code);
      else reject(new Error("No code in callback"));
    });
    server.listen(PORT, () => {
      console.log(`Opening browser for consent (listening on ${REDIRECT_URI}) ...`);
      console.log(`If it doesn't open automatically, visit:\n${authUrl}\n`);
      const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      exec(`${opener} "${authUrl}"`);
    });
  });

  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      "No refresh_token returned. This usually means the account already granted consent before.\n" +
        "Revoke prior access at https://myaccount.google.com/permissions and re-run this script."
    );
    process.exit(1);
  }

  console.log("\nSuccess. Add this to your .env / Vercel project environment variables:\n");
  console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
