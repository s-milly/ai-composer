// Plays songs: sampled instruments (FatBoy soundfont, one recording every third note, shifted to
// the exact pitch), drums made from scratch with oscillators and noise, and a light room reverb.
import { INST, GUITARS } from "./catalog.js";

let ac = null, master = null, wet = null, noise = null;
const banks = {};  // instrument id -> Promise of { midi: AudioBuffer }
const SAMPLE_NOTES = []; for (let m = 31; m < 91; m += 3) SAMPLE_NOTES.push(m);
let base = "site/";
export const setBase = b => (base = b);

export function context() {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    master = ac.createGain(); master.gain.value = 0.85;
    master.connect(comp).connect(ac.destination);
    // a short, soft room reverb from a decaying noise burst
    const len = Math.floor(ac.sampleRate * 1.6), ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    const verb = ac.createConvolver(); verb.buffer = ir;
    wet = ac.createGain(); wet.gain.value = 0.16;
    wet.connect(verb).connect(comp);
    const nlen = ac.sampleRate; noise = ac.createBuffer(1, nlen, ac.sampleRate);
    const nd = noise.getChannelData(0); for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;
  }
  return ac;
}

export function loadInstrument(id) {
  if (!INST[id]) return Promise.resolve(null);
  if (!banks[id]) {
    const ctx = context();
    banks[id] = Promise.all(SAMPLE_NOTES.map(m => fetch(`${base}samples/${id}/${m}.mp3`).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(b => new Promise((ok, no) => ctx.decodeAudioData(b, ok, no))).then(buf => [m, buf])))
      .then(Object.fromEntries)
      .catch(e => { delete banks[id]; throw e; });
  }
  return banks[id];
}

function bus(gain) {
  const g = ac.createGain(); g.gain.value = gain;
  g.connect(master); g.connect(wet);
  return g;
}

function sampleNote(bank, id, p, on, dur, vel, out) {
  const baseNote = SAMPLE_NOTES.reduce((a, m) => (Math.abs(m - p) < Math.abs(a - p) ? m : a));
  const src = ac.createBufferSource();
  src.buffer = bank[baseNote];
  src.playbackRate.value = Math.pow(2, (p - baseNote) / 12);
  const g = ac.createGain(), off = on + dur, rel = INST[id].decays ? 0.3 : 0.1;
  g.gain.setValueAtTime(0, on);
  g.gain.linearRampToValueAtTime(vel, on + 0.01);
  g.gain.setValueAtTime(vel, Math.max(on + 0.011, off - 0.02));
  g.gain.linearRampToValueAtTime(0, off + rel);
  src.connect(g).connect(out);
  src.start(on); src.stop(off + rel + 0.05);
  return src;
}

/* ---------- Drums, built from oscillators and noise ---------- */
function noiseHit(t, out, { type = "highpass", freq = 7000, q = 0.7, decay = 0.05, gain = 0.5 }) {
  const src = ac.createBufferSource(); src.buffer = noise;
  const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + decay);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 0.5); src.stop(t + decay + 0.05);
  return src;
}
function toneHit(t, out, { from, to, decay, gain, type = "sine" }) {
  const o = ac.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + decay * 0.6);
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + decay);
  o.connect(g).connect(out); o.start(t); o.stop(t + decay + 0.05);
  return o;
}
export function drum(d, t, v, out) {
  switch (d) {
    case "kick": return [toneHit(t, out, { from: 140, to: 42, decay: 0.42, gain: 1.1 * v }), noiseHit(t, out, { type: "lowpass", freq: 900, decay: 0.03, gain: 0.25 * v })];
    case "snare": return [toneHit(t, out, { from: 220, to: 160, decay: 0.12, gain: 0.45 * v, type: "triangle" }), noiseHit(t, out, { type: "bandpass", freq: 2200, q: 0.6, decay: 0.2, gain: 0.75 * v })];
    case "clap": return [0, 0.012, 0.024].map(dt => noiseHit(t + dt, out, { type: "bandpass", freq: 1300, q: 1.2, decay: dt === 0.024 ? 0.2 : 0.03, gain: 0.7 * v }));
    case "hat": return [noiseHit(t, out, { freq: 8000, decay: 0.045, gain: 0.35 * v })];
    case "open": return [noiseHit(t, out, { freq: 7000, decay: 0.32, gain: 0.3 * v })];
    case "ride": return [noiseHit(t, out, { type: "bandpass", freq: 7500, q: 1.5, decay: 0.55, gain: 0.32 * v }), toneHit(t, out, { from: 5200, to: 5000, decay: 0.4, gain: 0.04 * v, type: "square" })];
    case "crash": return [noiseHit(t, out, { freq: 4500, decay: 1.6, gain: 0.45 * v })];
    case "tom": return [toneHit(t, out, { from: 130, to: 80, decay: 0.5, gain: 0.9 * v }), noiseHit(t, out, { type: "lowpass", freq: 600, decay: 0.08, gain: 0.3 * v })];
  }
  return [];
}

/* ---------- Playing a song ---------- */
// Seconds from the start of the song to a sixteenth-note step; swing pushes the second eighth
// note of each beat later.
export function timeOf(song, s) {
  const six = 60 / song.tempo / 4;
  return (s + (song.swing && Math.round(s) % 4 === 2 ? song.swing : 0)) * six;
}

let live = [], playing = null;

// Players are never perfectly together. A guitarist strums a chord one string after another
// (down from the low string on the beat, back up from the high string between beats), a harpist
// rolls it, a pianist's fingers land a few milliseconds apart, and every note varies a little in
// timing and strength. dt is the shift in seconds.
function humanize(part) {
  const id = part.inst, strum = GUITARS.has(id), harp = id === "orchestral_harp";
  const jitter = INST[id].decays ? 0.006 : 0.01, out = [];
  const byStep = new Map();
  for (const n of part.notes) { if (!byStep.has(n.s)) byStep.set(n.s, []); byStep.get(n.s).push(n); }
  for (const [s, chord] of byStep) {
    const lead = (Math.random() - 0.5) * jitter;
    chord.sort((a, b) => a.p - b.p);
    const up = strum && s % 4 === 2 && chord.length > 2;
    const order = up ? chord.slice().reverse() : chord;
    const gap = strum ? (up ? 0.009 : 0.014) * (0.8 + Math.random() * 0.4) : harp ? 0.028 : 0;
    order.forEach((n, i) => {
      const spread = chord.length > 1 && !gap ? Math.random() * 0.007 : 0;
      const dt = Math.max(-0.008, lead + i * gap + spread);
      // an upstroke catches the top strings harder than the bottom ones
      const v = (n.v ?? 0.8) * (0.93 + Math.random() * 0.12) * (up ? 0.86 : 1) * (strum && i > 0 ? 1 - i * 0.025 : 1);
      out.push({ ...n, dt, v });
    });
  }
  return out;
}

export async function play(song, onStatus = () => {}) {
  const ctx = context();
  if (ctx.state === "suspended") await ctx.resume();
  const ids = [...new Set(song.parts.map(p => p.inst).filter(id => INST[id]))];
  onStatus("Loading the instruments…");
  const loaded = Object.fromEntries(await Promise.all(ids.map(async id => [id, await loadInstrument(id)])));
  stop();
  const t0 = ctx.currentTime + 0.12, six = 60 / song.tempo / 4;
  const active = song.parts.filter(p => INST[p.inst]).length + (song.drums.hits.length ? 1 : 0) || 1;
  const level = 0.95 / Math.sqrt(active);
  for (const part of song.parts) {
    if (!INST[part.inst]) continue;
    const out = bus(level); live.push(out);
    for (const n of humanize(part)) {
      const on = t0 + timeOf(song, n.s) + n.dt;
      // the last chord rings a little longer
      const dur = n.l * six * (n.s + n.l >= song.steps ? 1.6 : 1);
      live.push(sampleNote(loaded[part.inst], part.inst, n.p, on, dur, n.v, out));
    }
  }
  if (song.drums.hits.length) {
    const out = bus(level * 0.9); live.push(out);
    for (const h of song.drums.hits) live.push(...drum(h.d, t0 + timeOf(song, h.s), h.v ?? 0.8, out));
  }
  playing = { song, t0, end: t0 + timeOf(song, song.steps) + 1 };
  onStatus("");
  return playing;
}

export function stop() {
  for (const n of live) { try { if (n.stop) n.stop(); else n.disconnect(); } catch (e) { /* already stopped */ } }
  live = [];
  playing = null;
}

export const now = () => (ac ? ac.currentTime : 0);
export const current = () => playing;

// A single note or drum hit, for the Song Maker.
export async function preview(id, p, beats = 0.5, v = 0.8) {
  const ctx = context(); if (ctx.state === "suspended") await ctx.resume();
  const out = bus(0.7);
  setTimeout(() => out.disconnect(), 4000);
  if (id === "drums") { drum(p, ctx.currentTime + 0.01, v, out); return; }
  const bank = await loadInstrument(id);
  if (bank) sampleNote(bank, id, p, ctx.currentTime + 0.01, beats * 0.5, v, out);
}

// How brightly each part (and the drums, last) is lit at time t: full when a note starts,
// settling while it rings, fading after it ends.
export function lights(song, t) {
  const six = 60 / song.tempo / 4;
  const lit = song.parts.map(part => {
    if (!INST[part.inst]) return 0;
    let best = 0;
    for (const n of part.notes) {
      const on = timeOf(song, n.s); if (on > t) break;
      const off = on + n.l * six;
      const v = t < off ? 0.55 + 0.45 * Math.exp(-(t - on) / 0.18) : 0.55 * Math.exp(-(t - off) / 0.12);
      if (v > best) best = v;
    }
    return best;
  });
  let d = 0;
  for (const h of song.drums.hits) {
    const on = timeOf(song, h.s); if (on > t) break;
    d = Math.max(d, Math.exp(-(t - on) / 0.16));
  }
  lit.push(song.drums.hits.length ? d : 0);
  return lit;
}
