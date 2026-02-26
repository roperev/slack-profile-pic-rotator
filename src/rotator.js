import path from 'path';
import { getConfig, saveConfig } from './config.js';
import { setPhoto } from './slack-api.js';
import { getImageByIndex, getImageCount, listImages } from './images-local.js';
import { ensureSlackSize } from './image-resize.js';

let timerId = null;

/** Fisher–Yates shuffle. Returns a new array; does not mutate input. */
function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getImageCountForSource() {
  const config = getConfig();
  if (config.imageSource === 'local' && config.localPath) {
    return getImageCount(config.localPath);
  }
  if (config.imageSource === 'google' && config.googleAlbumId) {
    return 0; // TODO Google: return media count
  }
  return 0;
}

/** Ensure roundOrder is valid for current image count; init or reshuffle if needed. */
function ensureRoundOrder(count) {
  const config = getConfig();
  let roundOrder = Array.isArray(config.roundOrder) ? config.roundOrder : [];
  let roundIndex = typeof config.roundIndex === 'number' ? config.roundIndex : 0;
  if (roundOrder.length !== count) {
    roundOrder = shuffle(Array.from({ length: count }, (_, i) => i));
    roundIndex = 0;
    saveConfig({ roundOrder, roundIndex });
  }
  return { roundOrder, roundIndex };
}

/**
 * Get next image bytes and mime based on current config (does not advance index).
 */
export function getNextImage() {
  const config = getConfig();
  if (config.imageSource === 'local' && config.localPath) {
    const count = getImageCount(config.localPath);
    const { roundOrder, roundIndex } = ensureRoundOrder(count);
    const effectiveIndex = roundOrder[roundIndex];
    return getImageByIndex(config.localPath, effectiveIndex);
  }
  if (config.imageSource === 'google' && config.googleAlbumId) {
    throw new Error('Google Photos source not implemented yet');
  }
  throw new Error('No image source configured. Use set-source local /path/to/pics');
}

/**
 * Perform one rotation step: get next image, resize, upload to Slack, advance index.
 * No-ops if paused (when called from timer). Returns { success: boolean, error?: string }.
 */
export async function performRotation(ignorePaused = false) {
  const config = getConfig();
  if (!ignorePaused && config.paused) {
    return { success: true, skipped: true };
  }

  const count = getImageCountForSource();
  if (count === 0) {
    return { success: false, error: 'No images in source' };
  }

  let buffer, mimeType;
  try {
    const img = getNextImage();
    buffer = img.buffer;
    mimeType = img.mimeType;
  } catch (err) {
    return { success: false, error: err.message };
  }

  const resized = await ensureSlackSize(buffer, mimeType);
  const result = await setPhoto(resized.buffer, resized.mimeType);
  if (!result.ok) {
    return { success: false, error: result.error || 'Slack API error' };
  }

  const paths = config.imageSource === 'local' && config.localPath ? listImages(config.localPath) : [];
  const { roundOrder, roundIndex } = ensureRoundOrder(count);
  const currentFilename = paths.length ? path.basename(paths[roundOrder[roundIndex]]) : null;
  const nextRoundIndex = (roundIndex + 1) % count;

  let newRoundOrder = roundOrder;
  let newRoundIndex = nextRoundIndex;
  if (nextRoundIndex === 0) {
    newRoundOrder = shuffle(Array.from({ length: count }, (_, i) => i));
    newRoundIndex = 0;
  }

  const totalChanges = (getConfig().totalChanges ?? 0) + 1;
  saveConfig({ roundOrder: newRoundOrder, roundIndex: newRoundIndex, totalChanges });

  let nextFilename = paths.length ? path.basename(paths[newRoundOrder[newRoundIndex]]) : null;

  if (nextRoundIndex === 0 && paths.length > 0) {
    const newFirstIndex = newRoundOrder[0];
    try {
      const nextImg = getImageByIndex(config.localPath, newFirstIndex);
      const nextResized = await ensureSlackSize(nextImg.buffer, nextImg.mimeType);
      const nextResult = await setPhoto(nextResized.buffer, nextResized.mimeType);
      if (nextResult.ok) {
        const newNextIndex = newRoundOrder[1 % count];
        nextFilename = path.basename(paths[newNextIndex]);
      }
      return {
        success: true,
        currentFilename: path.basename(paths[newFirstIndex]),
        nextFilename,
      };
    } catch {
      return {
        success: true,
        currentFilename: path.basename(paths[newFirstIndex]),
        nextFilename: paths.length ? path.basename(paths[newRoundOrder[1 % count]]) : null,
      };
    }
  }

  return { success: true, currentFilename, nextFilename };
}

/**
 * Force one rotation now (ignores paused).
 */
export async function changeNow() {
  return performRotation(true);
}

/**
 * Set profile pic to a specific image by index (0..count-1). Updates roundIndex so
 * that image becomes "current" and the next in round order becomes "next".
 */
export async function setToImageIndex(imageIndex) {
  const config = getConfig();
  const count = getImageCountForSource();
  if (count === 0) {
    return { success: false, error: 'No images in source' };
  }
  const normalizedIndex = ((imageIndex % count) + count) % count;
  const { roundOrder, roundIndex } = ensureRoundOrder(count);
  const pos = roundOrder.indexOf(normalizedIndex);
  if (pos === -1) {
    return { success: false, error: 'Image not in current round' };
  }

  let buffer, mimeType;
  try {
    const img = getImageByIndex(config.localPath, normalizedIndex);
    buffer = img.buffer;
    mimeType = img.mimeType;
  } catch (err) {
    return { success: false, error: err.message };
  }

  const resized = await ensureSlackSize(buffer, mimeType);
  const result = await setPhoto(resized.buffer, resized.mimeType);
  if (!result.ok) {
    return { success: false, error: result.error || 'Slack API error' };
  }

  const paths = listImages(config.localPath);
  const currentFilename = path.basename(paths[normalizedIndex]);
  const newRoundIndex = (pos + 1) % count;
  const nextFilename = paths.length ? path.basename(paths[roundOrder[newRoundIndex]]) : null;
  const totalChanges = (getConfig().totalChanges ?? 0) + 1;
  saveConfig({ roundIndex: newRoundIndex, totalChanges });
  return { success: true, currentFilename, nextFilename };
}

export function startTimer(intervalMinutes) {
  if (timerId != null) {
    clearInterval(timerId);
  }
  const ms = intervalMinutes * 60 * 1000;
  timerId = setInterval(() => {
    performRotation(false).then((r) => {
      if (!r.success && r.error) {
        console.error('Rotation failed:', r.error);
      } else if (r.success && !r.skipped && r.currentFilename) {
        const time = new Date().toLocaleTimeString();
        console.log(`Profile pic updated at ${time}. Set: ${r.currentFilename}  Next: ${r.nextFilename}`);
      }
    });
  }, ms);
  return timerId;
}

export function stopTimer() {
  if (timerId != null) {
    clearInterval(timerId);
    timerId = null;
  }
}

export function pause() {
  saveConfig({ paused: true });
}

export function resume() {
  saveConfig({ paused: false });
}

export function setIntervalMinutes(minutes) {
  saveConfig({ intervalMinutes: minutes });
  return minutes;
}

export function getTimerId() {
  return timerId;
}
