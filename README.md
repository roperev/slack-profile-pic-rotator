# Slack Profile Pic Rotator

A local service that rotates your Slack profile picture on a schedule. Uses a folder of images on your Mac and optional controls via CLI or a small web UI.

## Requirements

- Node.js 18+
- A Slack app with **user** scope `users.profile:write` (no bot token needed)

## Slack app setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and open your app (or create one).
2. **OAuth & Permissions**
   - Under **Redirect URLs**, add the URI you will use (see below).
   - Under **User Token Scopes**, add: `users.profile:write`
3. **Basic Information** — copy **Client ID** and **Client Secret**.
4. Install the app to your workspace (Install to Workspace).

### If Slack requires HTTPS (redirect URI mismatch)

Some workspaces only allow HTTPS redirect URIs. Use a tunnel so Slack can redirect to an HTTPS URL that forwards to your machine:

1. **Install a tunnel tool** (pick one):
   - [ngrok](https://ngrok.com): `brew install ngrok` then `ngrok http 4000`
   - [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps): `brew install cloudflared` then `cloudflared tunnel --url http://localhost:4000`

2. **Start the tunnel** in a separate terminal (before running `auth`):
   ```bash
   ngrok http 4000
   ```
   Copy the **HTTPS** URL it shows (e.g. `https://abc123.ngrok-free.app`).

3. **In your Slack app** → OAuth & Permissions → Redirect URLs:
   - Add: `https://YOUR-TUNNEL-URL/slack/callback`  
   - Example: `https://abc123.ngrok-free.app/slack/callback`

4. **In your `.env`** set:
   ```
   SLACK_REDIRECT_URI=https://YOUR-TUNNEL-URL/slack/callback
   ```
   (Use the same URL as in Slack, including `/slack/callback`.)

5. **Run auth** (with the tunnel still running):
   ```bash
   node src/index.js auth
   ```
   Slack will redirect to the HTTPS tunnel URL; the tunnel forwards to your local server and the tokens are saved. After that you can close the tunnel—you only need it for the one-time OAuth.

## Install

```bash
cd slack-profile-pic-bot
npm install
cp .env.example .env
```

Edit `.env` and set:

- `SLACK_CLIENT_ID` — from Slack app
- `SLACK_CLIENT_SECRET` — from Slack app
- `SLACK_REDIRECT_URI` — `http://localhost:4000/slack/callback` if Slack allows it; otherwise use an HTTPS tunnel URL (see “If Slack requires HTTPS” above).

## Usage

**Initial configuration:** Run `auth` once to connect Slack. Then either set your image folder via the CLI (`set-source local <path>`) or start the server and set it in the web UI by clicking "Click to set path" and entering the folder path. After that, use `start` to run the timer and UI.

### 1. Connect Slack (one time)

```bash
npm run auth
```

This opens your browser for Slack OAuth. After you approve, tokens are stored in `~/.slack-profile-rotator/tokens.json`.

### 2. Set image folder (CLI or web UI)

Put your profile pictures in a folder (e.g. `~/Pictures/slack-avatars`). Supported: `.jpg`, `.jpeg`, `.png`, `.gif`.

**Option A — CLI (before or after starting):**

```bash
node src/index.js set-source local ~/Pictures/slack-avatars
```

**Option B — Web UI:** Start the rotator (step 3), then open **http://localhost:4001**. Click **"Click to set path"** (or the path next to "All Images from") and enter the full path to your folder when prompted (e.g. `/Users/you/Pictures/slack-avatars`). The path is saved to config and the rotation timer starts automatically.

The image folder path must be **under your home directory** (e.g. `~/Pictures/slack-avatars` or `/Users/you/...`). Paths outside your home are rejected for security.

You can change the folder later the same way (click the path in the UI or run `set-source` again).

### 3. Start the rotator (timer + web UI)

```bash
npm start
# or
node src/index.js start
```

- You **do not** need to set an image folder first. If none is set, the server still starts and the web UI shows "Click to set path" so you can choose a folder in the browser.
- If a folder is already set, rotation runs on your chosen interval (default 60 minutes) and the UI shows your images and next-rotation order.
- **Web UI** at **http://localhost:4001**:
  - **Path** — Click "Click to set path" or the current path to set or change the image folder (enter full path in the prompt).
  - **Change now** — set profile to the next image immediately.
  - **Pause** / **Resume** — stop or resume automatic rotation.
  - **Interval** — 1 min, 5 min, 30 min, 1 hr, 4 hr, 12 hr, 24 hr.
  - **Rescan folder** — re-read the folder and reshuffle the rotation order.
  - **Theme** — Default or Adobe (red/black, glass cards).
- In the terminal: press **n** for next profile pic. **Ctrl+C** to stop.

Images are shown in a random order each round. When the last image in a round is used, the order is reshuffled and the new first image is set immediately.

### 4. Other commands

```bash
npm run change-now              # Set profile to next image now
node src/index.js pause        # Pause automatic rotation
node src/index.js resume       # Resume
node src/index.js set-interval 30   # Set interval to 30 minutes
node src/index.js set-source local /path/to/folder   # Set image folder
node src/index.js status       # Show config and auth status
```

## Optional: run at login (macOS)

To start the rotator when you log in:

```bash
./scripts/install-launchd.sh
```

This installs a LaunchAgent that runs `node src/index.js start` with your project directory and environment. Uninstall by removing `~/Library/LaunchAgents/com.slack.profile-rotator.plist`.

## Config and data

- **Config:** `~/.slack-profile-rotator/config.json` — image folder path (`localPath`), interval, paused, rotation order, etc. The path you set in the web UI or via `set-source` is stored here (resolved to an absolute path).
- **Tokens:** `~/.slack-profile-rotator/tokens.json` — Slack OAuth tokens (created with restricted permissions).

On macOS the config directory is `~/.slack-profile-rotator` unless `XDG_CONFIG_HOME` is set, in which case it is `$XDG_CONFIG_HOME/slack-profile-rotator`.

## Security and performance

- **Web UI** listens on `127.0.0.1:4001` only, so it is not reachable from other machines on the network.
- **Image folder** must be under your home directory (enforced for both CLI and web UI) so the app cannot be pointed at system directories.
- **Thumbnail endpoint** (`/api/thumb/:index`) validates that the requested file is inside the configured folder (no path traversal).
- **OAuth callback** error pages escape user-facing content to avoid XSS.
- **Tokens** are stored in `tokens.json` with `chmod 600` where supported. Keep `.env` and the config directory private.
- No long-lived timers or listeners that accumulate; the rotation interval is cleared and recreated when the interval is changed.

## Image requirements

Slack accepts 512×512 to 1024×1024 pixels (JPEG, PNG, GIF). This app resizes and letterboxes images automatically to fit.
