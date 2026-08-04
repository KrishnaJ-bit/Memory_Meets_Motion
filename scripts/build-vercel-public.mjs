import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'demo', 'autopilot-monitor');
const target = resolve(root, 'public');

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

for (const file of ['index.html', 'app.js', 'styles.css']) {
  await copyFile(resolve(source, file), resolve(target, file));
}

console.log(`Prepared Vercel static assets in ${target}`);
