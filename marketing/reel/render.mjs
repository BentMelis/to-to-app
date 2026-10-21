// Renders reel.html to an mp4 (1080x1920, 30 fps), frame by frame, so every frame is exact.
// Usage: node render.mjs [outDir] [--frames 0,90,180]  (needs playwright + ffmpeg)
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : join(here, 'out'));
const only = process.argv.includes('--frames') ? process.argv[process.argv.indexOf('--frames') + 1].split(',').map(Number) : null;
const frames = join(out, 'frames');
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await (await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 })).newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(pathToFileURL(join(here, 'reel.html')).href + '?render');
await page.evaluate(() => window.__reel.ready);
const { duration, fps } = await page.evaluate(() => ({ duration: window.__reel.duration, fps: window.__reel.fps }));
const total = Math.round(duration * fps);
const list = only ?? [...Array(total).keys()];
for (const i of list) {
  await page.evaluate((t) => window.__reel.seek(t), i / fps);
  await page.screenshot({ path: join(frames, `f${String(i).padStart(4, '0')}.png`) });
  if (i % 60 === 0) process.stdout.write(`${i}/${total}\r`);
}
await browser.close();
if (only) process.exit(0);

const mp4 = join(out, 'twiglist-reel.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(frames, 'f%04d.png'),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
console.log('\nwrote', mp4);
