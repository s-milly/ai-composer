// Writes a song in C major or A minor: a chord progression from the chord model, then a melody
// from the melody model over those chords, laid out in phrases that repeat the way songs do
// (A A', A B A', or A A' B A'').
import { loadNet, sample } from "./gru.js";

const Q = ["maj", "min", "7", "maj7", "min7", "dim", "hdim7", "sus", "aug"];
const NQ = Q.length, NONE = 12 * NQ;
const HOLD = 0, REST = 1, LOW = 52, N_TOK = 39;
let MEL = null, CH = null;

export async function loadWriter(base = "site/") {
  [MEL, CH] = await Promise.all([loadNet(base + "melody"), loadNet(base + "chords")]);
}
export const writerReady = () => !!MEL;
export const melodyGenres = () => MEL.meta.trained_genres;

const tok = (root, q) => root * NQ + Q.indexOf(q);
const rootOf = t => (t === NONE ? 12 : Math.floor(t / NQ));
const qualOf = t => (t === NONE ? 0 : t % NQ);

/* ---------- Chords, one per half bar ---------- */
function chordPhrase(genre, minor, slots, { start, end, prev, temp, offset = 0 }) {
  const g = CH.meta.genres.indexOf(genre), home = minor ? 9 : 0, five = minor ? 4 : 7;
  const homeQ = genre === "jazz" ? (minor ? "min7" : "maj7") : minor ? "min" : "maj";
  let h = CH.state(), p = prev ?? NONE;
  const out = [];
  for (let s = 0; s < slots; s++) {
    const [logits, next] = CH.step(h, { proot: rootOf(p), pqual: qualOf(p), slot: (offset + s) % 16, genre: g, mode: minor ? 1 : 0 });
    h = next;
    const bias = new Float32Array(N_TOK_CH());
    let t;
    if (s === 0 && start === "home") t = tok(home, homeQ);
    else if (end === "home" && s >= slots - 2) t = tok(home, homeQ);
    else {
      const runSame = out.length >= 4 && out.slice(-4).every(x => x === out[out.length - 1]);
      for (let i = 0; i < NONE; i++) {
        const r = rootOf(i);
        if (runSame && i === out[out.length - 1]) bias[i] -= 2.5;           // do not sit on one chord for over two bars
        if (s === 0 && start === "away" && r === home) bias[i] -= 3;        // a new section starts away from home
        if (end === "half" && s >= slots - 2 && r === five) bias[i] += 2.5;  // end the first phrase on the five chord
        if (end === "home" && s === slots - 3 && r === five) bias[i] += 1.5; // lead into the final chord
      }
      t = sample(logits, temp, i => i !== NONE, bias);
    }
    out.push(t); p = t;
  }
  return out;
}
const N_TOK_CH = () => NONE + 1;

/* ---------- Melody, one sixteenth note at a time ---------- */
// chords: one token per half bar. Writes steps [from, to) into mel, continuing from st.
function melody(st, mel, chords, from, to, opts) {
  const { genre, minor, dens, temp, replay, finalBar } = opts;
  const g = MEL.meta.genres.indexOf(genre), home = minor ? 9 : 0;
  for (let t = from; t < to; t++) {
    const prev = t > 0 ? mel[t - 1] : REST;
    // the pitch still sounding, how long it has rung, and how long the melody has been quiet
    let sound = 0, quiet = 0, held = 0, k = t - 1;
    while (k >= 0 && mel[k] === HOLD) { held++; k--; }
    if (k >= 0 && mel[k] >= 2) sound = mel[k] - 1;
    for (k = t - 1; k >= 0 && mel[k] === REST; k--) quiet++;
    const beat = Math.floor(t / 4), ch = chords[Math.floor(beat / 2)], nch = chords[Math.min(chords.length - 1, Math.floor((beat + 1) / 2))];
    const x = { prev, sound, root: rootOf(ch), qual: qualOf(ch), nroot: rootOf(nch), nqual: qualOf(nch),
      beat: t % 16, bar: Math.floor(t / 16) % 4, genre: g, mode: minor ? 1 : 0, dens };
    const [logits, next] = MEL.step(st.h, x);
    st.h = next;
    let pick;
    if (replay && replay[t] !== undefined) pick = replay[t];
    else if (finalBar !== undefined && t >= finalBar) {
      // the last bar: land on the home note closest to where the melody is, and let it ring
      if (t === finalBar) {
        let last = 70;
        for (let k = t - 1; k >= 0; k--) if (mel[k] >= 2) { last = mel[k] - 2 + LOW; break; }
        let best = 0, bd = 99;
        for (let p = LOW; p < LOW + 37; p++) if (p % 12 === home && Math.abs(p - last) < bd) { bd = Math.abs(p - last); best = p; }
        pick = best - LOW + 2;
      } else pick = t >= finalBar + 12 ? REST : HOLD;
    } else {
      pick = sample(logits, temp, i => {
        if (i === HOLD) return sound > 0 && held < 24;   // nothing to hold, or the note has rung for 1.5 bars
        if (i === REST) return quiet < 12 || t % 4 !== 0;   // do not leave the melody silent for long
        return true;
      });
    }
    mel[t] = pick;
  }
}

// Builds the whole song. Returns {chords (per half bar), melody (per sixteenth)} in C major / A minor.
export async function writeSong({ genre, melodyGenre, minor, bars, dens, temp, onProgress = () => {} }) {
  const half = 2, chordTemp = Math.min(0.85, Math.max(0.5, temp * 0.75));
  const plans = { 4: ["A"], 8: ["A", "A2"], 12: ["A", "B", "A2"], 16: ["A", "A2", "B", "A3"] }[bars];
  const A = chordPhrase(genre, minor, 4 * half, { start: "home", end: bars === 4 ? "home" : "half", temp: chordTemp });
  const B = bars >= 12 ? chordPhrase(genre, minor, 4 * half, { start: "away", end: "half", prev: A[A.length - 1], temp: chordTemp }) : null;
  const chords = [];
  plans.forEach(p => {
    if (p === "A") chords.push(...A);
    else if (p === "B") chords.push(...B);
    else {
      // the answering phrase keeps the first three bars and comes home in the fourth
      chords.push(...A.slice(0, 3 * half), ...chordPhrase(genre, minor, half, { end: "home", prev: A[5], temp: chordTemp, offset: 6 }));
    }
  });
  const steps = bars * 16, mel = new Array(steps).fill(REST), st = { h: MEL.state() };
  const opts = { genre: melodyGenre, minor, dens, temp };
  let phraseA = null;
  for (let i = 0; i < plans.length; i++) {
    const from = i * 64, to = from + 64, last = i === plans.length - 1;
    const replay = plans[i].startsWith("A") && plans[i] !== "A" && phraseA
      ? Object.fromEntries(phraseA.slice(0, 48).map((v, k) => [from + k, v])) : null;
    melody(st, mel, chords, from, to, { ...opts, replay, finalBar: last ? steps - 16 : undefined });
    if (plans[i] === "A") phraseA = mel.slice(from, to);
    onProgress(`Writing bar ${Math.min(bars, (i + 1) * 4)} of ${bars}`);
    await new Promise(r => setTimeout(r));
  }
  return { chords: chords.map(t => ({ root: rootOf(t), qual: Q[qualOf(t)] })), melody: mel };
}

// Just a new melody over the same chords.
export async function rewriteMelody(song, { melodyGenre, minor, dens, temp }) {
  const toks = song.chords.map(c => c.root * NQ + Q.indexOf(c.qual));
  const steps = song.melody.length, mel = new Array(steps).fill(REST), st = { h: MEL.state() };
  const bars = steps / 16, phrases = bars / 4;
  for (let i = 0; i < phrases; i++) {
    melody(st, mel, toks, i * 64, i * 64 + 64, { genre: melodyGenre, minor, dens, temp, finalBar: i === phrases - 1 ? steps - 16 : undefined });
    await new Promise(r => setTimeout(r));
  }
  return { chords: song.chords, melody: mel };
}
