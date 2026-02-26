import fs from 'fs';
import path from 'path';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif'];
const MIME_MAP = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
};

function getExtension(filename) {
  const ext = path.extname(filename).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext) ? ext : null;
}

/**
 * List image file paths in a directory (sorted for stable order).
 * @param {string} localPath - Absolute path to folder
 * @returns {string[]} Full paths to image files
 */
export function listImages(localPath) {
  if (!localPath || !fs.existsSync(localPath)) {
    return [];
  }
  const stat = fs.statSync(localPath);
  if (!stat.isDirectory()) {
    return [];
  }
  const names = fs.readdirSync(localPath);
  const paths = names
    .filter((n) => getExtension(n) != null)
    .map((n) => path.join(localPath, n))
    .filter((p) => fs.statSync(p).isFile());
  paths.sort();
  return paths;
}

/**
 * Get image at index (round-robin). Returns buffer and mime type.
 * @param {string} localPath
 * @param {number} index
 * @returns {{ buffer: Buffer, mimeType: string }}
 */
export function getImageByIndex(localPath, index) {
  const paths = listImages(localPath);
  if (paths.length === 0) {
    throw new Error(`No images found in ${localPath}. Add .jpg, .jpeg, .png, or .gif files.`);
  }
  const normalizedIndex = ((index % paths.length) + paths.length) % paths.length;
  const filePath = paths[normalizedIndex];
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_MAP[ext] || 'image/jpeg';
  const buffer = fs.readFileSync(filePath);
  return { buffer, mimeType };
}

export function getImageCount(localPath) {
  return listImages(localPath).length;
}
