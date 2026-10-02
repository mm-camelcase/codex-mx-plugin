// Renders the README hero (docs/hero/keypad.webp) by stepping scene.js frame by frame in headless Chrome.
// Not part of the app: needs playwright-core, Google Chrome and img2webp/cwebp (brew install webp).
//   npm i --no-save playwright-core && node docs/hero/record.mjs
//   node docs/hero/record.mjs --cards    # the three "how it works" stills (step-1..3.webp)
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import('playwright-core');
const root = fileURLToPath(new URL('.', import.meta.url));
const FPS = Number(process.env.FPS || 24), QUALITY = process.env.QUALITY || '70', SCALE = Number(process.env.SCALE || 1.5);
const still = process.argv.includes('--still') ? Number(process.argv[process.argv.indexOf('--still') + 1] || 0) : null;
const types = { '.html': 'text/html', '.js': 'text/javascript' };
// Close-ups for the README steps: a moment on the timeline plus a camera aimed at the key that matters.
const CARDS = [
  { t: 0.25, view: { azimuth: -0.5, elevation: 0.8, radius: 6.2, target: [-0.55, 0, -0.6] } },
  { t: 2.1, view: { azimuth: -0.36, elevation: 0.86, radius: 10.4, target: [0, 0.1, 0.1] } },
  { t: 8.2, view: { azimuth: 0.3, elevation: 0.84, radius: 6, target: [-0.5, 0, -0.55] } }
];
const cards = process.argv.includes('--cards');

const server = createServer(async (request, response) => {
  const file = normalize(join(root, new URL(request.url, 'http://x').pathname.replace(/\/$/, '/index.html')));
  if (!file.startsWith(root + (root.endsWith(sep) ? '' : sep)) || !types[extname(file)]) return response.writeHead(404).end();
  try { response.writeHead(200, { 'content-type': types[extname(file)] }).end(await readFile(file)); } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const frames = process.env.FRAMES || await mkdtemp(join(tmpdir(), 'keypad-hero-')); // set FRAMES to keep the PNGs
try {
  const page = await browser.newPage({ viewport: cards ? { width: 640, height: 640 } : { width: 1200, height: 600 }, deviceScaleFactor: SCALE });
  page.on('pageerror', error => { throw error; });
  await page.goto(`http://127.0.0.1:${server.address().port}/?record${cards ? '&card' : ''}`);
  const { loop } = await (await page.waitForFunction(() => window.heroReady, null, { timeout: 30000 })).jsonValue();
  const shoot = async (time, path, view) => { await page.evaluate(([t, v]) => window.renderAt(t, v), [time, view]); await page.screenshot({ path, omitBackground: true }); };
  if (cards) {
    for (const [index, { t, view }] of CARDS.entries()) {
      const png = join(frames, `card-${index}.png`), out = join(process.env.OUT || root, `step-${index + 1}.webp`);
      await shoot(t, png, view);
      execFileSync('cwebp', ['-quiet', '-sharp_yuv', '-q', '90', png, '-o', out]); console.log(out);
    }
  } else if (still !== null) {
    const path = process.env.OUT || join(root, 'still.png');
    await shoot(still, path); console.log(path);
  } else {
    const total = Math.round(loop * FPS), files = [];
    for (let frame = 0; frame < total; frame++) {
      files.push(join(frames, `${String(frame).padStart(4, '0')}.png`));
      await shoot(frame / FPS, files.at(-1));
    }
    const out = process.env.OUT || join(root, 'keypad.webp');
    execFileSync('img2webp', ['-loop', '0', '-sharp_yuv', '-min_size', '-lossy', '-q', QUALITY, '-m', '6', '-d', String(Math.round(1000 / FPS)), ...files, '-o', out], { stdio: 'inherit' });
    console.log(out);
  }
} finally {
  await browser.close(); server.close(); if (!process.env.FRAMES) await rm(frames, { recursive: true, force: true });
}
