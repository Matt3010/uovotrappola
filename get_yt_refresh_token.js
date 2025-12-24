const { google } = require("googleapis");
const readline = require("readline");
const dotenv = require("dotenv");

dotenv.config();

const oauth2Client = new google.auth.OAuth2(
    process.env.YT_OAUTH_CLIENT_ID,
    process.env.YT_OAUTH_CLIENT_SECRET,
    "urn:ietf:wg:oauth:2.0:oob"
);

const scopes = ["https://www.googleapis.com/auth/youtube"];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: scopes,
  prompt: "consent" // forza la consegna del refresh token
});

console.log("\n🔗 Apri questo link nel browser:");
console.log(authUrl);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question("\n👉 Incolla qui il codice ricevuto: ", async (code) => {
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log("\n✅ REFRESH TOKEN GENERATO:\n");
    console.log(tokens.refresh_token);
  } catch (err) {
    console.error("❌ ERRORE:", err.message);
  } finally {
    rl.close();
  }
});