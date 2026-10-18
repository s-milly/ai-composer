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
        if (s === 0 && start === "lift") bias[i] += r === home ? -3 : (minor ? [5, 0] : [5, 9]).includes(r) ? 2.5 : 0;  // a chorus often opens on IV or vi
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

// Song forms, four bars per phrase. Each entry is section:how:ending.
//   new     a new phrase           answer  repeats the first three bars of that section's first phrase, new last bar
//   repeat  plays phrase number n again (a second verse and chorus)
// A is the verse, C the chorus and B the bridge.
const FORMS = {
  4: ["A:new:home"],
  8: ["A:new:half", "A:answer:home"],
  12: ["A:new:half", "B:new:half", "A:answer:home"],
  16: ["A:new:half", "A:answer:home", "B:new:half", "A:answer:home"],
  24: ["A:new:half", "A:answer:home", "C:new:half", "C:answer:home", "B:new:half", "A:answer:home"],
  32: ["A:new:half", "A:answer:home", "C:new:half", "C:answer:home", "A:repeat:0", "A:repeat:1", "C:repeat:2", "C:answer:home"],
};
export const LENGTHS = Object.keys(FORMS).map(Number);

// Builds the whole song. Returns {chords (per half bar), melody (per sixteenth)} in C major / A minor.
export async function writeSong({ genre, melodyGenre, minor, bars, dens, temp, keepChords = null, onProgress = () => {} }) {
  const half = 2, chordTemp = Math.min(0.85, Math.max(0.5, temp * 0.75));
  const form = FORMS[bars].map(x => { const [sec, how, end] = x.split(":"); return { sec, how, end }; });
  // one chord progression per section: the verse starts at home, the chorus lifts to another chord, the bridge goes away
  const start = { A: "home", C: "lift", B: "away" };
  const prog = {};
  for (const sec of [...new Set(form.map(f => f.sec))]) {
    const end = form.length === 1 ? "home" : "half";
    prog[sec] = chordPhrase(genre, minor, 4 * half, { start: start[sec], end, prev: prog.A ? prog.A[prog.A.length - 1] : undefined, temp: chordTemp });
  }
  const steps = bars * 16, mel = new Array(steps).fill(REST), st = { h: MEL.state() };
  const chords = [], first = {};
  for (let i = 0; i < form.length; i++) {
    const f = form[i], from = i * 64, last = i === form.length - 1;
    let ch, replay = null;
    if (f.how === "repeat") {
      const k = +f.end;
      ch = chords.slice(k * 8, k * 8 + 8);
      replay = Object.fromEntries(mel.slice(k * 64, k * 64 + 64).map((v, j) => [from + j, v]));
    } else if (f.how === "answer") {
      // keeps the first three bars and comes home in the fourth
      const P = prog[f.sec];
      ch = [...P.slice(0, 3 * half), ...chordPhrase(genre, minor, half, { end: "home", prev: P[5], temp: chordTemp, offset: 6 })];
      replay = Object.fromEntries(mel.slice(first[f.sec] * 64, first[f.sec] * 64 + 48).map((v, j) => [from + j, v]));
    } else ch = prog[f.sec];
    if (keepChords) ch = keepChords.slice(i * 8, i * 8 + 8);
    chords.push(...ch);
    if (f.how === "new") first[f.sec] = i;
    // the chorus is a little busier than the verse
    const d = f.sec === "C" ? Math.min(2, dens + 1) : dens;
    melody(st, mel, chords, from, from + 64, { genre: melodyGenre, minor, dens: d, temp, replay, finalBar: last ? steps - 16 : undefined });
    onProgress(`Writing bar ${Math.min(bars, (i + 1) * 4)} of ${bars}`);
    await new Promise(r => setTimeout(r));
  }
  return { chords: chords.map(t => ({ root: rootOf(t), qual: Q[qualOf(t)] })), melody: mel, form: form.map(f => f.sec) };
}

// Just a new melody over the same chords, in the same form.
export function rewriteMelody(song, opts) {
  return writeSong({ ...opts, bars: song.melody.length / 16, keepChords: song.chords.map(c => c.root * NQ + Q.indexOf(c.qual)) });
}
