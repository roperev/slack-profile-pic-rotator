import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_DIR = process.env.XDG_CONFIG_HOME
  ? path.join(process.env.XDG_CONFIG_HOME, 'slack-profile-rotator')
  : path.join(process.env.HOME || process.env.USERPROFILE, '.slack-profile-rotator');

const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const TOKENS_PATH = path.join(CONFIG_DIR, 'tokens.json');

const DEFAULT_CONFIG = {
  imageSource: 'local',
  localPath: '',
  googleAlbumId: null,
  intervalMinutes: 60,
  paused: false,
  currentIndex: 0,
  roundOrder: [],
  roundIndex: 0,
  totalChanges: 0,
};

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function getConfigPath() {
  return CONFIG_PATH;
}

export function getConfigDir() {
  return CONFIG_DIR;
}

export function getTokensPath() {
  return TOKENS_PATH;
}

export function getConfig() {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return { ...DEFAULT_CONFIG };
  }
  const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return { ...DEFAULT_CONFIG, ...data };
}

export function saveConfig(updates) {
  ensureConfigDir();
  const current = getConfig();
  const next = { ...current, ...updates };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

export function getTokens() {
  ensureConfigDir();
  if (!fs.existsSync(TOKENS_PATH)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export function saveTokens(tokens) {
  ensureConfigDir();
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
  try {
    fs.chmodSync(TOKENS_PATH, 0o600);
  } catch {
    // ignore on Windows
  }
}

export function hasSlackToken() {
  const tokens = getTokens();
  return tokens?.slack?.access_token != null;
}
