// node render.mjs stills 0.5 3.5 ...   → stills/t-<time>.png
// node render.mjs video                → frames piped to ffmpeg → video-silent.mp4
import http from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const DIR = dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html', '.png': 'image/png', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  try {
    const p = join(DIR, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'video.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--force-color-profile=srgb', '--hide-scrollbars', '--font-render-hinting=none'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${port}/video.html`, { waitUntil: 'networkidle0' });
await page.evaluate(() => window.ready);
const DUR = await page.evaluate(() => window.DUR);

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'stills') {
  mkdirSync(join(DIR, 'stills'), { recursive: true });
  for (const t of rest.map(Number)) {
    await page.evaluate(t => window.seek(t), t);
    await page.screenshot({ path: join(DIR, 'stills', `t-${t.toFixed(2)}.png`) });
  }
} else {
  const FPS = 30, N = Math.round(DUR * FPS);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(DIR, 'video-silent.mp4')], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = 0; f < N; f++) {
    await page.evaluate(t => window.seek(t), f / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 60 === 0) process.stdout.write(`frame ${f}/${N}\n`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
}
await browser.close();
server.close();
