import sharp from 'sharp';

const MIN_SIDE = 512;
const MAX_SIDE = 1024;

/**
 * Resize image for Slack: 512–1024 px, square (letterbox if needed).
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {Promise<{ buffer: Buffer, mimeType: string }>}
 */
export async function ensureSlackSize(buffer, mimeType) {
  const isGif = mimeType === 'image/gif';
  let input = sharp(buffer, { animated: false });
  if (isGif) {
    input = sharp(buffer).gif({ page: 0 });
  }

  const meta = await input.metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (width === 0 || height === 0) {
    throw new Error('Could not read image dimensions');
  }

  const outFormat = mimeType === 'image/jpeg' ? 'jpeg' : mimeType === 'image/gif' ? 'gif' : 'png';
  const outMime = outFormat === 'jpeg' ? 'image/jpeg' : outFormat === 'gif' ? 'image/gif' : 'image/png';

  const resized = await input
    .resize({
      fit: 'inside',
      width: MAX_SIDE,
      height: MAX_SIDE,
      withoutEnlargement: false,
    })
    .toFormat(outFormat, { quality: 90 })
    .toBuffer();

  const resizedMeta = await sharp(resized).metadata();
  let w = resizedMeta.width || 0;
  let h = resizedMeta.height || 0;
  if (w < MIN_SIDE || h < MIN_SIDE) {
    const scale = MIN_SIDE / Math.min(w, h);
    const scaled = await sharp(resized)
      .resize(Math.round(w * scale), Math.round(h * scale))
      .toFormat(outFormat, { quality: 90 })
      .toBuffer();
    const scaledMeta = await sharp(scaled).metadata();
    w = scaledMeta.width || 0;
    h = scaledMeta.height || 0;
    const side = Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.max(w, h)));
    const padded = await sharp(scaled)
      .extend({
        top: Math.max(0, Math.floor((side - h) / 2)),
        bottom: Math.max(0, Math.ceil((side - h) / 2)),
        left: Math.max(0, Math.floor((side - w) / 2)),
        right: Math.max(0, Math.ceil((side - w) / 2)),
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .resize(side, side)
      .toFormat(outFormat, { quality: 90 })
      .toBuffer();
    return { buffer: padded, mimeType: outMime };
  }

  const side = Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.max(w, h)));
  const padded = await sharp(resized)
    .extend({
      top: Math.max(0, Math.floor((side - h) / 2)),
      bottom: Math.max(0, Math.ceil((side - h) / 2)),
      left: Math.max(0, Math.floor((side - w) / 2)),
      right: Math.max(0, Math.ceil((side - w) / 2)),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .resize(side, side)
    .toFormat(outFormat, { quality: 90 })
    .toBuffer();

  return { buffer: padded, mimeType: outMime };
}
