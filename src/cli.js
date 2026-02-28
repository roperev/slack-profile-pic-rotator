import { hasSlackToken, getConfig, saveConfig } from './config.js';
import { runAuthFlow } from './slack-auth.js';
import * as rotator from './rotator.js';
import { getImageCount, listImages } from './images-local.js';
import path from 'path';
import os from 'os';

const COMMANDS = ['auth', 'start', 'change-now', 'pause', 'resume', 'set-interval', 'set-source', 'status'];
const INTERVAL_OPTIONS = [1, 5, 30, 60, 240, 720, 1440];

function usage() {
  console.log(`
Slack Profile Pic Rotator

Usage: node src/index.js <command> [options]

Commands:
  auth                  Connect Slack (opens browser for OAuth)
  start                 Start rotation timer and web UI (no image path required)
  change-now            Set profile to next image immediately
  pause                 Pause automatic rotation
  resume                Resume automatic rotation
  set-interval <n>      Set rotation interval in minutes (e.g. 1, 5, 30, 60, 240, 720, 1440)
  set-source local <path>  Set image folder path (optional; can also set in web UI)
  status                Show current config and auth status

Image folder:
  Set via CLI:  node src/index.js set-source local /path/to/folder
  Or in web UI: open http://localhost:4001, click "Click to set path" or the path, enter folder path.

Examples:
  node src/index.js auth
  node src/index.js set-source local ~/Pictures/slack-avatars
  node src/index.js start
  node src/index.js change-now
`);
}

function requireAuth() {
  if (!hasSlackToken()) {
    console.error('Not authenticated. Run: node src/index.js auth');
    process.exit(1);
  }
}

function isPathUnderSafeRoot(resolvedPath) {
  const home = os.homedir();
  const normalized = path.resolve(resolvedPath);
  const homeNorm = path.resolve(home);
  return normalized === homeNorm || normalized.startsWith(homeNorm + path.sep);
}

function validateLocalSource(localPath) {
  const resolved = path.resolve(localPath);
  if (!isPathUnderSafeRoot(resolved)) {
    console.error('Path must be under your home directory.');
    process.exit(1);
  }
  if (!listImages(resolved).length) {
    console.error(`No images found in ${resolved}. Add .jpg, .jpeg, .png, or .gif files.`);
    process.exit(1);
  }
  return resolved;
}

export async function run(argv) {
  const cmd = argv[2];
  const arg1 = argv[3];
  const arg2 = argv[4];

  if (!cmd || !COMMANDS.includes(cmd)) {
    usage();
    process.exit(cmd ? 1 : 0);
  }

  switch (cmd) {
    case 'auth': {
      if (hasSlackToken()) {
        console.log('Already authenticated.');
        return;
      }
      await runAuthFlow();
      return;
    }

    case 'start': {
      requireAuth();
      const config = getConfig();
      const hasLocalSource = config.imageSource === 'local' && config.localPath;
      const count = hasLocalSource ? getImageCount(config.localPath) : 0;

      if (hasLocalSource && count === 0) {
        validateLocalSource(config.localPath);
      }

      if (hasLocalSource) {
        console.log(`Starting rotator: ${config.intervalMinutes} min interval, ${count} images, paused=${config.paused}`);
        rotator.startTimer(config.intervalMinutes);
        if (!config.paused) {
          const r = await rotator.performRotation(true);
          if (r.success && !r.skipped) {
            const time = new Date().toLocaleTimeString();
            if (r.currentFilename != null) {
              console.log(`Profile pic updated at ${time}. Set: ${r.currentFilename}  Next: ${r.nextFilename}`);
            } else {
              console.log(`Profile pic updated at ${time}.`);
            }
          } else if (r.error) {
            console.error('Initial rotation failed:', r.error);
          }
        }
      } else {
        console.log('No image source set. Web UI: set a folder in the browser or run: node src/index.js set-source local /path/to/pics');
      }

      const { startServer } = await import('./server.js');
      await startServer();
      console.log('Web UI: http://localhost:4001');
      console.log("Press 'n' for next profile pic. Ctrl+C to stop.");

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', async (key) => {
          if (key === '\u0003' || key === '\x03') {
            process.exit(0);
          }
          if (key === 'n' || key === 'N') {
            const r = await rotator.changeNow();
            if (r.success) {
              const time = new Date().toLocaleTimeString();
              if (r.currentFilename != null) {
                console.log(`Profile pic updated at ${time}. Set: ${r.currentFilename}  Next: ${r.nextFilename}`);
              } else {
                console.log(`Profile pic updated at ${time}.`);
              }
            } else {
              console.error('Failed:', r.error);
            }
          }
        });
      }
      return;
    }

    case 'change-now': {
      requireAuth();
      const config = getConfig();
      if (config.imageSource === 'local' && config.localPath) {
        validateLocalSource(config.localPath);
      }
      const r = await rotator.changeNow();
      if (r.success) {
        const time = new Date().toLocaleTimeString();
        if (r.currentFilename != null) {
          console.log(`Profile pic updated at ${time}. Set: ${r.currentFilename}  Next: ${r.nextFilename}`);
        } else {
          console.log(`Profile pic updated at ${time}.`);
        }
      } else {
        console.error('Failed:', r.error);
        process.exit(1);
      }
      return;
    }

    case 'pause': {
      rotator.pause();
      saveConfig({ paused: true });
      console.log('Rotation paused.');
      return;
    }

    case 'resume': {
      rotator.resume();
      saveConfig({ paused: false });
      console.log('Rotation resumed.');
      return;
    }

    case 'set-interval': {
      const minutes = parseInt(arg1, 10);
      if (isNaN(minutes) || minutes < 1) {
        console.error('Usage: node src/index.js set-interval <minutes>');
        console.error('Example: node src/index.js set-interval 60');
        process.exit(1);
      }
      rotator.setIntervalMinutes(minutes);
      saveConfig({ intervalMinutes: minutes });
      if (rotator.getTimerId() != null) {
        rotator.stopTimer();
        rotator.startTimer(minutes);
      }
      console.log(`Interval set to ${minutes} minutes.`);
      return;
    }

    case 'set-source': {
      if (arg1 !== 'local' || !arg2) {
        console.error('Usage: node src/index.js set-source local <path>');
        process.exit(1);
      }
      const resolved = validateLocalSource(arg2);
      saveConfig({ imageSource: 'local', localPath: resolved, roundOrder: [], roundIndex: 0 });
      const count = getImageCount(resolved);
      console.log(`Source set to ${resolved} (${count} images).`);
      return;
    }

    case 'status': {
      const config = getConfig();
      const authenticated = hasSlackToken();
      let imageCount = 0;
      let nextFilename = null;
      if (config.imageSource === 'local' && config.localPath) {
        imageCount = getImageCount(config.localPath);
        if (imageCount > 0 && Array.isArray(config.roundOrder) && config.roundOrder.length === imageCount) {
          const paths = listImages(config.localPath);
          const roundIndex = typeof config.roundIndex === 'number' ? config.roundIndex : 0;
          nextFilename = path.basename(paths[config.roundOrder[roundIndex]]);
        }
      }
      console.log('Slack:', authenticated ? 'connected' : 'not connected');
      console.log('Image source:', config.imageSource);
      if (config.imageSource === 'local') {
        console.log('Local path:', config.localPath || '(not set)');
        console.log('Image count:', imageCount);
        if (nextFilename != null) {
          console.log('Next in round:', nextFilename);
        }
      }
      console.log('Interval:', config.intervalMinutes, 'minutes');
      console.log('Paused:', config.paused);
      console.log('Total changes made:', config.totalChanges ?? 0);
      if (imageCount > 0) {
        const roundIndex = typeof config.roundIndex === 'number' ? config.roundIndex : 0;
        console.log('Round position:', `${roundIndex + 1} of ${imageCount}`);
      }
      return;
    }

    default:
      usage();
      process.exit(1);
  }
}
