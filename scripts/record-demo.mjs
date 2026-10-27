/* Records the LinkedIn demo frames: title page, then analyses 01 and 06 with a drawn cursor.
   Requires Playwright (or playwright-core) in the caller's NODE_PATH, not at runtime.
   Usage: node scripts/record-demo.mjs [base-url] [frames-folder]
   Writes NNNN.png plus timeline.json ({file, ms}); encode with scripts/encode-demo-gif.py. */
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';

const require = createRequire(import.meta.url);
const {chromium} = (() => { try { return require('playwright'); } catch { return require('playwright-core'); } })();
const W = 1120, H = 1400, BASE = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = process.argv[3] || 'artifacts/demo-frames';
await fs.rm(OUT, {recursive: true, force: true});
await fs.mkdir(OUT, {recursive: true});

const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: W, height: H}, deviceScaleFactor: 1});
const timeline = [];
let n = 0;
async function shot(ms) {
  const file = `${String(n++).padStart(4, '0')}.png`;
  await page.screenshot({path: `${OUT}/${file}`});
  timeline.push({file, ms});
}
const hold = ms => { timeline[timeline.length - 1].ms += ms; };
const ease = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

// --- animation control: pause every finite CSS animation/transition and step it by hand
const pauseAll = () => page.evaluate(() => {
  for (const a of document.getAnimations()) {
    if (a.effect.getComputedTiming().iterations === Infinity) continue;
    a.pause(); a.currentTime = 0;
  }
});
async function stepAnimations(totalMs, stepMs) {
  for (let t = 0; t <= totalMs; t += stepMs) {
    await page.evaluate(t => {
      for (const a of document.getAnimations()) {
        if (a.effect.getComputedTiming().iterations === Infinity) continue;
        if (a.playState === 'paused') a.currentTime = t;
      }
    }, t);
    await shot(stepMs);
  }
  await page.evaluate(() => document.getAnimations().forEach(a => { if (a.playState === 'paused') a.finish(); }));
}
const finishAll = () => page.evaluate(() => document.getAnimations().forEach(a => {
  if (a.effect.getComputedTiming().iterations !== Infinity) a.finish();
}));

// --- fake cursor
async function installCursor() {
  await page.addStyleTag({content: `
    html{scroll-behavior:auto!important}
    #demo-cursor{position:fixed;left:0;top:0;width:26px;height:30px;z-index:2147483647;pointer-events:none;transform:translate(-2px,-2px)}
    #demo-ring{position:fixed;z-index:2147483646;pointer-events:none;border:3px solid #2f4ea8;border-radius:50%;opacity:0}`});
  await page.evaluate(() => {
    const c = document.createElement('div'); c.id = 'demo-cursor';
    c.innerHTML = '<svg viewBox="0 0 26 30" width="26" height="30"><path d="M2 2 L2 24 L8 18.5 L12.5 28 L16.5 26 L12 16.8 L20 16.8 Z" fill="#1d2440" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
    const r = document.createElement('div'); r.id = 'demo-ring';
    document.body.append(c, r);
    window.__cur = {x: 1180, y: 1300};
    c.style.left = __cur.x + 'px'; c.style.top = __cur.y + 'px';
  });
}
const setCursor = (x, y) => page.evaluate(([x, y]) => {
  const c = document.getElementById('demo-cursor'); c.style.left = x + 'px'; c.style.top = y + 'px'; window.__cur = {x, y};
}, [x, y]);
const center = async sel => {
  const b = await page.locator(sel).boundingBox();
  return [Math.round(b.x + Math.min(b.width * .5, 140)), Math.round(b.y + b.height * .55)];
};
async function moveTo(sel, frames = 9, ms = 40) {
  const [tx, ty] = await center(sel);
  const {x, y} = await page.evaluate(() => window.__cur);
  for (let i = 1; i <= frames; i++) {
    const k = ease(i / frames);
    await setCursor(Math.round(x + (tx - x) * k), Math.round(y + (ty - y) * k));
    await shot(ms);
  }
}
async function clickRing() {
  const {x, y} = await page.evaluate(() => window.__cur);
  for (const [r, o] of [[8, .9], [16, .7], [24, .4]]) {
    await page.evaluate(([x, y, r, o]) => {
      const s = document.getElementById('demo-ring').style;
      Object.assign(s, {left: x - r + 'px', top: y - r + 'px', width: 2 * r + 'px', height: 2 * r + 'px', opacity: o});
    }, [x, y, r, o]);
    await shot(50);
  }
  await page.evaluate(() => { document.getElementById('demo-ring').style.opacity = 0; });
}
async function scrollTo(y, frames = 12, ms = 40) {
  const y0 = await page.evaluate(() => scrollY);
  const {x: cx, y: cy} = await page.evaluate(() => window.__cur);
  for (let i = 1; i <= frames; i++) {
    await page.evaluate(v => window.scrollTo(0, v), Math.round(y0 + (y - y0) * ease(i / frames)));
    await shot(ms);
  }
  await setCursor(cx, cy);
}
const docTop = sel => page.evaluate(s => Math.round(document.querySelector(s).getBoundingClientRect().top + scrollY), sel);

// Record frames in real time until a condition holds; replay speeded up by `speed`.
async function recordUntil(cond, speed = 1, minGap = 0) {
  let last = Date.now();
  for (;;) {
    const done = await page.evaluate(cond);
    const now = Date.now();
    if (timeline.length) timeline[timeline.length - 1].ms = Math.max(timeline[timeline.length - 1].ms, Math.round((now - last) / speed));
    last = now;
    if (done) break;
    await shot(0);
    if (minGap) await page.waitForTimeout(minGap);
  }
}
const resultsShown = () => !document.getElementById('results').hidden;

// ================= Scene 1: title page
await page.goto(BASE, {waitUntil: 'domcontentloaded'});
await pauseAll();
await page.waitForFunction(() => document.fonts.status === 'loaded' && document.getElementById('dataset-badge').textContent.includes('1,470'));
await pauseAll();
await installCursor();
await stepAnimations(2150, 75);
hold(3200);

// cursor to "Try an analysis", click, scroll to the lab
await moveTo('.hero .primary-button', 12);
hold(250);
await clickRing();
await finishAll();
const labTop = await docTop('#lab');
await scrollTo(labTop + 40, 8, 55);
await finishAll();
await shot(700);

// ================= Scene 2: analysis 01 — proportion by department
await moveTo('#group-by', 10);
await clickRing();
await page.locator('#group-by').selectOption('Department');
await shot(900);
await moveTo('#run-button', 10);
hold(150);
await clickRing();
await page.locator('#run-button').click();
await recordUntil(resultsShown, 1, 120);
await pauseAll();
await page.locator('#parameter-select').selectOption('Human Resources').catch(() => {});
await pauseAll();
await shot(200);
await stepAnimations(1100, 70);

hold(3800);

// ================= Scene 3: analysis 06 — hierarchical partial pooling
await moveTo('#tab-hierarchical', 12);
await clickRing();
await page.locator('#tab-hierarchical').click();
await finishAll();
await shot(600);
await moveTo('#group-by', 10);
await clickRing();
await page.locator('#group-by').selectOption('JobRole');
await shot(900);
await moveTo('#run-button', 10);
hold(150);
await clickRing();
await page.locator('#run-button').click();
await recordUntil(resultsShown, 1.6, 250);
await pauseAll();
await shot(300);
// bring the pooling chart into view, then let it draw
const overview = await docTop('#model-overview');
await scrollTo(overview - 440, 7, 55);
await pauseAll();
await stepAnimations(1000, 70);
hold(4200);
// down to the posterior histogram and the MCMC traces
const charts = await docTop('#interpretation');
await scrollTo(charts - 40, 7, 55);
await pauseAll();
await stepAnimations(1350, 75);
hold(3800);

await fs.writeFile(`${OUT}/timeline.json`, JSON.stringify(timeline, null, 1));
const total = timeline.reduce((s, f) => s + f.ms, 0);
console.log('frames', timeline.length, 'total ms', total);
await browser.close();
