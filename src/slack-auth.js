import express from 'express';
import open from 'open';
import { getTokens, saveTokens } from './config.js';

const SCOPE = 'users.profile:write';

function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildAuthUrl() {
  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = process.env.SLACK_REDIRECT_URI || 'http://localhost:4000/slack/callback';
  if (!clientId) {
    throw new Error('SLACK_CLIENT_ID is not set. Copy from your Slack app and add to .env');
  }
  // users.profile:write is a User Token Scope — must use user_scope, not scope (which is for Bot scopes)
  const params = new URLSearchParams({
    client_id: clientId,
    user_scope: SCOPE,
    redirect_uri: redirectUri,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

function getPortFromRedirectUri() {
  const uri = process.env.SLACK_REDIRECT_URI || 'http://localhost:4000/slack/callback';
  try {
    const u = new URL(uri);
    // For HTTPS tunnel (e.g. ngrok), redirect URI has no port; listen on 4000 locally
    if (u.port && u.port !== '') {
      return parseInt(u.port, 10);
    }
    return 4000;
  } catch {
    return 4000;
  }
}

export function startCallbackServer() {
  let callbackResolve;
  const whenCallback = new Promise((r) => {
    callbackResolve = r;
  });

  return new Promise((resolve, reject) => {
    const app = express();
    const port = getPortFromRedirectUri();

    app.get('/slack/callback', async (req, res) => {
      const code = req.query.code;
      if (!code) {
        res.status(400).send('<h1>Missing code</h1><p>Slack did not return an authorization code. Try again.</p>');
        callbackResolve();
        return;
      }

      const clientId = process.env.SLACK_CLIENT_ID;
      const clientSecret = process.env.SLACK_CLIENT_SECRET;
      const redirectUri = process.env.SLACK_REDIRECT_URI || 'http://localhost:4000/slack/callback';

      if (!clientId || !clientSecret) {
        res.status(500).send('<h1>Server misconfigured</h1><p>SLACK_CLIENT_ID and SLACK_CLIENT_SECRET must be set.</p>');
        callbackResolve();
        return;
      }

      try {
        const form = new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        });
        const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        });
        const data = await tokenRes.json();

        if (!data.ok) {
          const errMsg = escapeHtml(data.error || 'Unknown error');
          const jsonSafe = escapeHtml(JSON.stringify(data, null, 2));
          res.status(400).send(`<h1>Slack error</h1><p>${errMsg}</p><pre>${jsonSafe}</pre>`);
          callbackResolve();
          return;
        }

        // When only user_scope is requested, the user token is in authed_user
        const userToken = data.authed_user?.access_token ?? data.access_token;
        const refreshToken = data.authed_user?.refresh_token ?? data.refresh_token ?? null;
        const expiresAt = data.authed_user?.expires_at ?? data.expires_at ?? null;

        const tokens = getTokens() || {};
        tokens.slack = {
          access_token: userToken,
          refresh_token: refreshToken,
          expires_at: expiresAt,
        };
        saveTokens(tokens);

        res.send(
          '<h1>Success!</h1><p>Slack is connected. You can close this window and return to the terminal.</p><p>Run: <code>rotator set-source local /path/to/pics</code> then <code>rotator start</code></p>'
        );
      } catch (err) {
        const msg = escapeHtml(err?.message || String(err));
        res.status(500).send(`<h1>Error</h1><pre>${msg}</pre>`);
      } finally {
        callbackResolve();
      }
    });

    const server = app.listen(port, () => {
      console.log(`Callback server listening on http://localhost:${port} (leave this running until you complete OAuth in the browser).`);
      resolve({ server, whenCallback });
    });
    server.on('error', reject);
  });
}

export async function runAuthFlow() {
  const url = buildAuthUrl();
  const { server, whenCallback } = await startCallbackServer();
  await open(url);
  console.log('Opened Slack authorization in your browser. Complete the flow there.');
  console.log('Waiting for callback... (do not close this terminal until you see "Success" in the browser)');
  await whenCallback;
  server.close();
  console.log('Slack connected. Set image source with: node src/index.js set-source local /path/to/pics');
  console.log('Then run: node src/index.js start');
}
