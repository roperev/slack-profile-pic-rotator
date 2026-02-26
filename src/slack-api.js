import { getTokens, saveTokens } from './config.js';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export async function getAccessToken() {
  const tokens = getTokens();
  if (!tokens?.slack?.access_token) {
    throw new Error('Not authenticated. Run: node src/index.js auth');
  }

  const slack = tokens.slack;
  const hasRefresh = slack.refresh_token && slack.expires_at != null;
  const expiresAt = slack.expires_at ? slack.expires_at * 1000 : null;
  const now = Date.now();
  const needsRefresh = hasRefresh && expiresAt != null && now >= expiresAt - FIVE_MINUTES_MS;

  if (!needsRefresh) {
    return slack.access_token;
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return slack.access_token;
  }

  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: slack.refresh_token,
  });
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const data = await res.json();
  if (!data.ok) {
    console.warn('Slack token refresh failed:', data.error);
    return slack.access_token;
  }

  tokens.slack = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? slack.refresh_token,
    expires_at: data.expires_at ?? null,
  };
  saveTokens(tokens);
  return tokens.slack.access_token;
}

/**
 * Set the Slack user profile photo. Uses multipart/form-data.
 * @param {Buffer} imageBuffer
 * @param {string} mimeType - e.g. image/jpeg, image/png
 * @returns {{ ok: boolean, error?: string }}
 */
export async function setPhoto(imageBuffer, mimeType) {
  const token = await getAccessToken();

  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/gif' ? 'gif' : 'jpg';
  const filename = `avatar.${ext}`;
  const blob = new Blob([imageBuffer], { type: mimeType });
  const form = new FormData();
  form.append('image', blob, filename);

  const res = await fetch('https://slack.com/api/users.setPhoto', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  const data = await res.json();
  if (!data.ok) {
    return { ok: false, error: data.error || 'Unknown error' };
  }
  return { ok: true };
}
