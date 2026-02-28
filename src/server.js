import express from 'express';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { hasSlackToken, getConfig, saveConfig } from './config.js';
import * as rotator from './rotator.js';
import { getImageCount, listImages } from './images-local.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const PORT = 4001;

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
let server = null;

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.static(publicDir));

  app.get('/api/status', (req, res) => {
    const config = getConfig();
    let imageCount = 0;
    if (config.imageSource === 'local' && config.localPath) {
      imageCount = getImageCount(config.localPath);
    }
    res.json({
      authenticated: hasSlackToken(),
      imageSource: config.imageSource,
      localPath: config.localPath || null,
      intervalMinutes: config.intervalMinutes,
      paused: config.paused,
      currentIndex: config.currentIndex,
      roundIndex: typeof config.roundIndex === 'number' ? config.roundIndex : 0,
      imageCount,
    });
  });

  app.post('/api/change-now', async (req, res) => {
    if (!hasSlackToken()) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    try {
      const result = await rotator.changeNow();
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/set-to-index', async (req, res) => {
    if (!hasSlackToken()) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const imageIndex = parseInt(req.body?.imageIndex, 10);
    if (isNaN(imageIndex) || imageIndex < 0) {
      return res.status(400).json({ success: false, error: 'Invalid imageIndex' });
    }
    try {
      const result = await rotator.setToImageIndex(imageIndex);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/pause', (req, res) => {
    rotator.pause();
    saveConfig({ paused: true });
    res.json({ success: true });
  });

  app.post('/api/resume', (req, res) => {
    rotator.resume();
    saveConfig({ paused: false });
    res.json({ success: true });
  });

  app.post('/api/interval', (req, res) => {
    const minutes = parseInt(req.body?.minutes, 10);
    if (isNaN(minutes) || minutes < 1) {
      return res.status(400).json({ success: false, error: 'Invalid minutes' });
    }
    rotator.setIntervalMinutes(minutes);
    saveConfig({ intervalMinutes: minutes });
    if (rotator.getTimerId() != null) {
      rotator.stopTimer();
      rotator.startTimer(minutes);
    }
    res.json({ success: true });
  });

  app.get('/api/images', (req, res) => {
    const config = getConfig();
    if (config.imageSource !== 'local' || !config.localPath) {
      return res.json({ images: [], roundOrder: [], roundIndex: 0 });
    }
    const paths = listImages(config.localPath);
    const images = paths.map((p, i) => ({ index: i, filename: path.basename(p) }));
    const roundOrder = Array.isArray(config.roundOrder) && config.roundOrder.length === paths.length
      ? config.roundOrder
      : [];
    const roundIndex = typeof config.roundIndex === 'number' ? config.roundIndex : 0;
    res.json({ images, roundOrder, roundIndex });
  });

  app.get('/api/thumb/:index', (req, res) => {
    const config = getConfig();
    if (config.imageSource !== 'local' || !config.localPath) {
      return res.status(404).end();
    }
    const paths = listImages(config.localPath);
    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0 || index >= paths.length) {
      return res.status(404).end();
    }
    const filePath = path.resolve(paths[index]);
    const baseDir = path.resolve(config.localPath);
    if (!filePath.startsWith(baseDir + path.sep) && filePath !== baseDir) {
      return res.status(403).end();
    }
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath, { maxAge: 60 }, (err) => {
      if (err) res.status(404).end();
    });
  });

  app.post('/api/rescan', (req, res) => {
    const config = getConfig();
    if (config.imageSource !== 'local' || !config.localPath) {
      return res.status(400).json({ success: false, error: 'No local source set' });
    }
    const paths = listImages(config.localPath);
    const count = paths.length;
    const roundOrder = count > 0
      ? shuffle(Array.from({ length: count }, (_, i) => i))
      : [];
    saveConfig({ roundOrder, roundIndex: 0 });
    res.json({ success: true, imageCount: count });
  });

  app.get('/api/source', (req, res) => {
    const config = getConfig();
    res.json({
      imageSource: config.imageSource,
      localPath: config.localPath || null,
      imageCount: config.imageSource === 'local' && config.localPath ? getImageCount(config.localPath) : 0,
    });
  });

  /** Resolved path must be under the user's home dir to avoid serving system dirs. */
  function isPathUnderSafeRoot(resolvedPath) {
    const home = os.homedir();
    const normalized = path.resolve(resolvedPath);
    const homeNorm = path.resolve(home);
    return normalized === homeNorm || normalized.startsWith(homeNorm + path.sep);
  }

  app.post('/api/source', (req, res) => {
    const { imageSource, localPath } = req.body || {};
    if (imageSource === 'local' && localPath) {
      const resolved = path.resolve(localPath);
      if (!fs.existsSync(resolved)) {
        return res.status(400).json({ success: false, error: 'Path does not exist' });
      }
      if (!isPathUnderSafeRoot(resolved)) {
        return res.status(400).json({ success: false, error: 'Path must be under your home directory' });
      }
      const paths = listImages(resolved);
      if (paths.length === 0) {
        return res.status(400).json({ success: false, error: 'No images in folder' });
      }
      saveConfig({ imageSource: 'local', localPath: resolved });
      rotator.startTimer(getConfig().intervalMinutes);
      return res.json({ success: true, imageCount: paths.length });
    }
    res.status(400).json({ success: false, error: 'Invalid source' });
  });

  return app;
}

export async function startServer() {
  if (server) return server;
  const app = createApp();
  return new Promise((resolve) => {
    server = app.listen(PORT, '127.0.0.1', () => {
      resolve(server);
    });
  });
}
