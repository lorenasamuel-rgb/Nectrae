// Score + SFX as one piece, A minor, 100 bpm. Writes music.wav (48 kHz stereo).
import { writeFileSync } from 'node:fs';

const SR = 48000, DUR = 24.4, N = Math.ceil(SR * DUR);
const bus = () => [new Float32Array(N), new Float32Array(N)];
const dry = bus(), send = bus(), dly = bus();
const BEAT = 0.6;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1; })();

function add(b, t0, len, fn, gain = 1, pan = 0, sendAmt = 0, delayAmt = 0) {
  const i0 = Math.round(t0 * SR), n = Math.round(len * SR);
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < n; i++) {
    const k = i0 + i; if (k < 0 || k >= N) continue;
    const v = fn(i / SR);
    b[0][k] += v * gl; b[1][k] += v * gr;
    if (sendAmt) { send[0][k] += v * gl * sendAmt; send[1][k] += v * gr * sendAmt; }
    if (delayAmt) { dly[0][k] += v * gl * delayAmt; dly[1][k] += v * gr * delayAmt; }
  }
}
const env = (t, a, d) => t < a ? t / a : Math.exp(-(t - a) / d);

// ---- instruments ----
function pad(t0, len, notes, gain) {
  for (const [j, m] of notes.entries()) {
    const f = mtof(m), det = [0.997, 1.003];
    add(dry, t0, len + 1.2, t => {
      const a = Math.min(1, t / 0.9) * (t > len ? Math.max(0, 1 - (t - len) / 1.2) : 1);
      let v = 0;
      for (const d of det) { const ph = 2 * Math.PI * f * d * t; v += Math.sin(ph) + 0.22 * Math.sin(2 * ph) + 0.08 * Math.sin(3 * ph); }
      return v * a * (1 + 0.15 * Math.sin(2 * Math.PI * 0.3 * t + j));
    }, gain / notes.length, (j / (notes.length - 1)) * 0.8 - 0.4, 0.5);
  }
}
function pluck(t0, m, gain, pan = 0, decay = 0.28) {
  const f = mtof(m);
  add(dry, t0, decay * 6, t => {
    const e = env(t, 0.004, decay);
    return e * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 18));
  }, gain, pan, 0.35, 0.45);
}
function bass(t0, m, len, gain) {
  const f = mtof(m);
  add(dry, t0, len + 0.1, t => {
    const a = Math.min(1, t / 0.01) * (t > len ? Math.max(0, 1 - (t - len) / 0.1) : 1) * Math.exp(-t * 1.2);
    return Math.tanh(1.6 * Math.sin(2 * Math.PI * f * t)) * a;
  }, gain);
}
function kick(t0, gain) {
  add(dry, t0, 0.35, t => {
    const ph = 2 * Math.PI * (48 * t + (75 / 30) * (1 - Math.exp(-t * 30)));
    return Math.sin(ph) * Math.exp(-t * 11);
  }, gain);
}
function hat(t0, gain, pan) {
  let lp = 0, prev = 0;
  add(dry, t0, 0.06, t => { const x = rnd(); const hp = x - prev; prev = x; lp = lp * 0.3 + hp * 0.7; return lp * Math.exp(-t * 70); }, gain, pan, 0.2);
}
function click(t0, gain, pan = 0) {
  let lp = 0;
  add(dry, t0, 0.03, t => { lp = lp * 0.55 + rnd() * 0.45; return lp * Math.exp(-t * 260); }, gain, pan, 0.1);
}
function thud(t0, gain) {
  // block: muted low A with a soft body, no click spike
  add(dry, t0, 0.9, t => {
    const f = 110 * (1 + 0.5 * Math.exp(-t * 25));
    return (Math.sin(2 * Math.PI * f * t) * 0.9 + 0.35 * Math.sin(2 * Math.PI * 164.81 * t) * Math.exp(-t * 6)) * env(t, 0.006, 0.18);
  }, gain, 0, 0.35);
  let lp = 0;
  add(dry, t0, 0.2, t => { lp = lp * 0.9 + rnd() * 0.1; return lp * Math.exp(-t * 30); }, gain * 1.4, 0, 0.2);
}
function bell(t0, root, gain) {
  const parts = [[1, 1, 1.6], [2, 0.5, 1.1], [3, 0.25, 0.8], [4.2, 0.12, 0.5], [1.5, 0.35, 1.2]];
  for (const [r, a, d] of parts) add(dry, t0, 4, t => Math.sin(2 * Math.PI * mtof(root) * r * t) * a * env(t, 0.003, d), gain, 0, 0.8, 0.35);
}
function whoosh(t0, len, gain) {
  let lp = 0;
  add(dry, t0, len, t => { const x = t / len; const c = 0.02 + 0.2 * x; lp = lp * (1 - c) + rnd() * c; return lp * Math.sin(Math.PI * x) ** 2; }, gain, 0, 0.6);
}

// ---- score ----
const A3 = 57, C4 = 60, E4 = 64, F3 = 53, G3 = 55, B3 = 59, D4 = 62;
const chords = [
  [0, [A3, C4, E4, 69], 45, [69, 72, 76, 72]],
  [4.8, [F3, A3, C4, 65], 41, [65, 69, 72, 76]],
  [9.6, [G3, C4, E4, 67], 48, [67, 72, 76, 79]],
  [14.4, [G3, B3, D4, 67], 43, [67, 71, 74, 79]],
  [19.2, [A3, C4, E4, 69], 45, [69, 72, 76, 81]],
];
chords.forEach(([t0, notes], i) => pad(t0, i === 4 ? DUR - t0 - 1.2 : 4.8, notes, i === 0 ? 0.13 : 0.13));

// groove from the reveal to the outro hit
for (let b = 8; b * BEAT < 21.4 - 0.01; b++) {
  const t = b * BEAT, [, , root, arp] = chords[Math.min(4, Math.floor(t / 4.8))];
  kick(t, b < 15 ? 0.17 : 0.22);
  if (t >= 9.0) hat(t + BEAT / 2, 0.05, 0.3);
  if (b % 2 === 0) bass(t, root, 0.5, 0.2);
  else bass(t + BEAT / 2, root, 0.22, 0.12);
  pluck(t, arp[b % 4] + 12, 0.045, -0.3, 0.16);
  pluck(t + BEAT / 2, arp[(b + 2) % 4] + 12, 0.035, 0.3, 0.14);
}

// ---- sfx, tied to picture ----
// S1: typing, then each line is a note climbing the A minor pentatonic; blocks drop to a low A
for (let i = 0; i < 12; i++) click(0.15 + i * 0.046, 0.05, 0.2);
const LT = [0.9, 1.1, 1.3, 1.5, 1.7, 1.9];
[69, 72, 74, 76, 79, 81].forEach((m, i) => pluck(LT[i], m, 0.11, -0.2 + i * 0.08, 0.22));
thud(2.35, 0.28); thud(2.75, 0.3);
// S2: reveal
whoosh(4.35, 0.6, 0.12); bell(4.95, 81, 0.07); bell(5.25, 76, 0.045);
// S3: three allowed payments, one blocked
[[9.7, 76], [10.0, 79], [10.3, 81]].forEach(([t, m]) => pluck(t, m, 0.08, 0.25, 0.2));
click(10.6, 0.06); thud(11.0, 0.32);
// S4: typing the wrong address, click, block
whoosh(13.45, 0.5, 0.08);
for (let i = 0; i < 16; i++) click(14.3 + i * 0.05, 0.035, -0.2);
click(15.35, 0.09, 0.1); thud(15.55, 0.32);
// S5: squint, then shut
whoosh(17.85, 0.5, 0.08);
pluck(19.05, 76, 0.07, 0, 0.3); thud(19.8, 0.2);
// S6: outro hit
whoosh(20.9, 0.6, 0.12); kick(21.4, 0.26); bass(21.4, 33, 2.2, 0.22); bell(21.45, 81, 0.08); bell(21.75, 88, 0.035);

// ---- space: dotted-eighth delay + small Schroeder reverb ----
const D = Math.round(SR * BEAT * 0.75);
for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) {
  const fb = i >= D ? dly[1 - c][i - D] * 0.38 : 0;
  dly[c][i] += fb;
}
for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) send[c][i] += dly[c][i] * 0.35;
function reverb(x, off) {
  const out = new Float32Array(N);
  for (const [ms, g] of [[29.7, .80], [37.1, .79], [41.1, .78], [43.7, .77]]) {
    const d = Math.round((ms + off) * SR / 1000), buf = new Float32Array(N); let lp = 0;
    for (let i = 0; i < N; i++) { const y = x[i] + (i >= d ? (lp = lp * 0.4 + buf[i - d] * 0.6) * g : 0); buf[i] = y; out[i] += y; }
  }
  let y = out;
  for (const ms of [5.0, 1.7]) {
    const d = Math.round(ms * SR / 1000), z = new Float32Array(N);
    for (let i = 0; i < N; i++) { const xd = i >= d ? y[i - d] : 0, zd = i >= d ? z[i - d] : 0; z[i] = -0.7 * y[i] + xd + 0.7 * zd; }
    y = z;
  }
  return y;
}
const rv = [reverb(send[0], 0), reverb(send[1], 2.3)];

// ---- mix ----
const L = new Float32Array(N), R = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const t = i / SR, fade = Math.min(1, t / 0.05) * Math.min(1, (DUR - t) / 1.6);
  L[i] = Math.tanh((dry[0][i] + dly[0][i] * 0.3 + rv[0][i] * 0.12) * 1.3) * fade;
  R[i] = Math.tanh((dry[1][i] + dly[1][i] * 0.3 + rv[1][i] * 0.12) * 1.3) * fade;
}
let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = 0.89 / peak;
const out = Buffer.alloc(44 + N * 4);
out.write('RIFF', 0); out.writeUInt32LE(36 + N * 4, 4); out.write('WAVE', 8); out.write('fmt ', 12);
out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(SR, 24);
out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { out.writeInt16LE(Math.round(L[i] * g * 32767), 44 + i * 4); out.writeInt16LE(Math.round(R[i] * g * 32767), 46 + i * 4); }
writeFileSync(new URL('./music.wav', import.meta.url), out);
console.log('peak', peak.toFixed(3));
