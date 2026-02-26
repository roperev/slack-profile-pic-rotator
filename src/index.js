import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

import { run } from './cli.js';

const cmd = process.argv[2];
const isStart = cmd === 'start';

run(process.argv)
  .then(() => {
    if (!isStart) {
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
