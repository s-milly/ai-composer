// The composer network (a 2-layer GRU trained on Bach chorales), run by hand in JavaScript.
// It writes four parts on a sixteenth-note grid in C major or A minor; toParts() moves the
// result into the chosen key.

const LOW = 33, HOLD = 0, REST = 1, N_TOK = 54;
const RANGES = [[60, 81], [53, 74], [48, 69], [36, 62]];  // per voice, in C major / A minor
let W = null, H = 256;

export async function loadComposer(base = "site/") {
  const [meta, buf] = await Promise.all([
    fetch(base + "model.json").then(r => r.json()),
    fetch(base + "model.bin").then(r => r.arrayBuffer()),
  ]);
  W = {};
  for (const [k, m] of Object.entries(meta)) {
    const rows = m.shape.length > 1 ? m.shape[0] : 1;
    const n = m.shape.reduce((a, b) => a * b, 1), cols = n / rows;
    const q = new Int8Array(buf, m.q, n), s = new Float32Array(buf, m.s, rows), w = new Float32Array(n);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) w[r * cols + c] = q[r * cols + c] * s[r];
    W[k] = { w, rows, cols };
  }
  H = W["rnn.weight_hh_l0"].cols;
}

function row(name, i) { const e = W[name]; return e.w.subarray(i * e.cols, (i + 1) * e.cols); }

// One GRU layer step, same equations as PyTorch (gates in the order r, z, n).
function gru(layer, x, h) {
  const wi = W[`rnn.weight_ih_l${layer}`], wh = W[`rnn.weight_hh_l${layer}`];
  const bi = W[`rnn.bias_ih_l${layer}`].w, bh = W[`rnn.bias_hh_l${layer}`].w;
  const gi = new Float32Array(3 * H), gh = new Float32Array(3 * H);
  for (let r = 0; r < 3 * H; r++) {
    let a = bi[r], b = bh[r];
    const oi = r * wi.cols, oh = r * wh.cols;
    for (let c = 0; c < wi.cols; c++) a += wi.w[oi + c] * x[c];
    for (let c = 0; c < H; c++) b += wh.w[oh + c] * h[c];
    gi[r] = a; gh[r] = b;
  }
  const out = new Float32Array(H);
  for (let j = 0; j < H; j++) {
    const r = 1 / (1 + Math.exp(-(gi[j] + gh[j])));
    const z = 1 / (1 + Math.exp(-(gi[H + j] + gh[H + j])));
    const n = Math.tanh(gi[2 * H + j] + r * gh[2 * H + j]);
    out[j] = (1 - z) * n + z * h[j];
  }
  return out;
}

export function step(st, prev, ctx, voice, beat, end, mode) {
  const d = W["tok.weight"].cols, x = new Float32Array(d);
  const add = v => { for (let i = 0; i < d; i++) x[i] += v[i]; };
  add(row("tok.weight", prev)); add(row("voice.weight", voice)); add(row("beat.weight", beat));
  add(row("end.weight", end)); add(row("mode.weight", mode));
  for (let u = 0; u < 4; u++) add(row(`sound.${u}.weight`, ctx[u]));
  st.h0 = gru(0, x, st.h0);
  st.h1 = gru(1, st.h0, st.h1);
  const o = W["out.weight"], b = W["out.bias"].w, logits = new Float32Array(N_TOK);
  for (let r = 0; r < N_TOK; r++) { let a = b[r]; for (let c = 0; c < H; c++) a += o.w[r * H + c] * st.h1[c]; logits[r] = a; }
  return logits;
}

function pick(logits, v, t, sound, now, temp) {
  const ok = new Array(N_TOK).fill(false);
  const [lo, hi] = RANGES[v];
  for (let m = lo; m <= hi; m++) ok[m - LOW + 2] = true;
  if (v > 0 && now[v - 1] > 0) for (let k = now[v - 1] + 2; k < N_TOK; k++) ok[k] = false;  // no crossing above the next voice up
  ok[HOLD] = t > 0 && sound[v] > 0;
  // no parallel fifths or octaves against any part already written at this step
  const blocked = ok.slice();
  if (sound[v] > 0) for (let k = 2; k < N_TOK; k++) {
    if (!ok[k]) continue;
    const b0 = sound[v], b1 = k - 1;
    for (let u = 0; u < v; u++) {
      const a0 = sound[u], a1 = now[u];
      if (!a0 || a0 === a1 || b0 === b1 || Math.sign(a1 - a0) !== Math.sign(b1 - b0)) continue;
      const iv = (((a1 - b1) % 12) + 12) % 12;
      if ((iv === 0 || iv === 7) && (((a0 - b0) % 12) + 12) % 12 === iv) blocked[k] = false;
    }
  }
  if (blocked.some(Boolean)) blocked.forEach((b, k) => (ok[k] = b));
  let max = -Infinity;
  for (let k = 0; k < N_TOK; k++) if (ok[k]) max = Math.max(max, logits[k] / temp);
  let sum = 0; const p = new Float32Array(N_TOK);
  for (let k = 0; k < N_TOK; k++) if (ok[k]) { p[k] = Math.exp(logits[k] / temp - max); sum += p[k]; }
  let r = Math.random() * sum;
  for (let k = 0; k < N_TOK; k++) { if (!ok[k]) continue; r -= p[k]; if (r <= 0) return k; }
  return ok.lastIndexOf(true);
}

// True if every part is sounding and the last chord is the home chord with the tonic in the bass.
function endsHome(sound, minor) {
  if (sound.some(x => x === 0)) return false;
  const pc = x => (x - 1 + LOW) % 12, tonic = minor ? 9 : 0;
  const pcs = sound.map(pc);
  const inChord = third => pcs.every(p => p === tonic || p === (tonic + third) % 12 || p === (tonic + 7) % 12);
  return pc(sound[3]) === tonic && (inChord(3) || inChord(4));
}

// Writes the song a few steps at a time so the page stays responsive. If it does not end on the
// home chord, the last two bars are written again, up to 8 tries.
export async function compose(bars, minor, temp, melody, onProgress = () => {}) {
  const steps = bars * 16, grid = Array.from({ length: steps }, () => [0, 0, 0, 0]);
  let st = { h0: new Float32Array(H), h1: new Float32Array(H) };
  let sound = [0, 0, 0, 0], prev = REST, saved = null, tries = 0;
  const redo = Math.max(0, bars - 2) * 16;
  for (let t = 0; t < steps; ) {
    if (t === redo && !saved) saved = { h0: st.h0, h1: st.h1, sound: sound.slice(), prev };
    const now = sound.slice();
    for (let v = 0; v < 4; v++) {
      const ctx = [0, 1, 2, 3].map(u => (u < v ? now[u] : sound[u]));
      const logits = step(st, prev, ctx, v, t % 16, Math.min(3, bars - 1 - Math.floor(t / 16)), minor);
      const tok = melody && v === 0 ? melody[t] : pick(logits, v, t, sound, now, temp);
      grid[t][v] = tok;
      if (tok !== HOLD) now[v] = tok - 1;
      prev = tok;
    }
    sound = now;
    t++;
    if (t % 8 === 0) { onProgress(tries ? `Rewriting the ending (try ${tries + 1})` : `Writing bar ${Math.ceil(t / 16)} of ${bars}`); await new Promise(r => setTimeout(r)); }
    if (t === steps && !endsHome(sound, minor) && tries < 7) {
      tries++;
      st = { h0: saved.h0, h1: saved.h1 }; sound = saved.sound.slice(); prev = saved.prev; t = redo;
    }
  }
  return grid;
}

// Semitones to move C major / A minor into the chosen key, kept within a fourth either way.
export function shiftFor(key, minor) {
  let shift = ((key - (minor ? 9 : 0)) % 12 + 12) % 12;
  return shift > 6 ? shift - 12 : shift;
}

// Grid tokens to four lists of notes {p, s, l} in the chosen key.
export function toParts(grid, key, minor) {
  const shift = shiftFor(key, minor);
  const parts = [[], [], [], []];
  for (let v = 0; v < 4; v++) {
    let cur = null;
    grid.forEach((cell, t) => {
      const tok = cell[v];
      if (tok === HOLD && cur) { cur.l++; return; }
      cur = null;
      if (tok >= 2) { cur = { p: tok - 2 + LOW + shift, s: t, l: 1 }; parts[v].push(cur); }
    });
  }
  return parts;
}
