/**
 * Google OAuth2 Setup Helper
 * Run this script once to obtain your GOOGLE_REFRESH_TOKEN
 *
 * Usage:
 *   1. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env
 *   2. Run: node utils/googleOAuth.js
 *   3. Open the URL in your browser and authorize
 *   4. Copy the refresh token and add it to your .env as GOOGLE_REFRESH_TOKEN
 */

require('dotenv').config();
const { google } = require('googleapis');
const http = require('http');
const url = require('url');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3001/api/auth/google/callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('ERROR: Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file first.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly'
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent'
});

console.log('\n=== Google OAuth2 Setup ===\n');
console.log('1. Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n2. Authorize the application');
console.log('3. You will be redirected to localhost:3001 — the server below will catch it.\n');
console.log('Starting local callback server on port 3001...\n');

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname === '/api/auth/google/callback') {
    const code = parsedUrl.query.code;

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<h1>Error: No authorization code received</h1>');
      return;
    }

    try {
      const { tokens } = await oauth2Client.getToken(code);

      console.log('\n=== SUCCESS ===\n');
      console.log('Add this to your .env file:\n');
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log('\n===============\n');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <h1>Authorization Successful!</h1>
        <p>Your refresh token has been printed in the terminal.</p>
        <p>Add it to your .env file as <code>GOOGLE_REFRESH_TOKEN</code></p>
        <p>You can close this window now.</p>
      `);

      // Close server after a short delay
      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 2000);
    } catch (error) {
      console.error('Error exchanging code for tokens:', error.message);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<h1>Error</h1><p>${error.message}</p>`);
    }
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(3001, () => {
  console.log('Callback server listening on http://localhost:3001');
  console.log('Waiting for OAuth callback...\n');
});
