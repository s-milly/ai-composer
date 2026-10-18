// Turns a written song (chords and a melody) into band parts for a style: the melody on the lead
// instrument, two accompaniment parts built from the chords (held pads, arpeggios, strums,
// stabs, power chords, jazz comping...) and a bass line. These are fixed playing patterns, one set
// per style; the chords and melody they play come from the models.
import { STYLES, BEATS } from "./catalog.js";

const SHAPES = { maj: [0, 4, 7], min: [0, 3, 7], "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10],
  dim: [0, 3, 6], hdim7: [0, 3, 6, 10], sus: [0, 5, 7], aug: [0, 4, 8] };
const LOW = 52, HOLD = 0, REST = 1;

export function shiftFor(key, minor) {
  let shift = ((key - (minor ? 9 : 0)) % 12 + 12) % 12;
  return shift > 6 ? shift - 12 : shift;
}

// Chord tones near a center pitch, choosing the inversion closest to the previous voicing.
function voice(pcs, prev, center, n) {
  const options = [];
  for (let inv = 0; inv < pcs.length; inv++) {
    const order = pcs.slice(inv).concat(pcs.slice(0, inv)).slice(0, n);
    let p = center - 7 + ((order[0] - (center - 7)) % 12 + 12) % 12;
    const v = [p];
    for (let i = 1; i < order.length; i++) { let q = v[i - 1] + 1; while (q % 12 !== order[i]) q++; v.push(q); }
    options.push(v);
  }
  if (!prev) return options.sort((a, b) => Math.abs(a[0] + a[a.length - 1] - 2 * center) - Math.abs(b[0] + b[b.length - 1] - 2 * center))[0];
  const cost = v => v.reduce((s, p, i) => s + Math.abs(p - (prev[Math.min(i, prev.length - 1)] ?? p)), 0) + Math.abs((v[0] + v[v.length - 1]) / 2 - center) * 0.5;
  return options.sort((a, b) => cost(a) - cost(b))[0];
}

export function melodyNotes(mel, shift) {
  const out = [];
  let cur = null;
  mel.forEach((t, s) => {
    if (t === HOLD && cur) { cur.l++; return; }
    cur = null;
    if (t >= 2) { cur = { p: t - 2 + LOW + shift, s, l: 1, v: s % 16 === 0 ? 0.92 : s % 4 === 0 ? 0.85 : 0.78 }; out.push(cur); }
  });
  return out;
}

export function arrange(written, { style, band, drums, tempo, key, minor }) {
  const S = STYLES[style], shift = shiftFor(key, minor);
  const steps = written.melody.length, bars = steps / 16, finalBar = (bars - 1) * 16;
  const slots = written.chords.map(c => {
    const root = (c.root + shift + 12) % 12, shape = SHAPES[c.qual] || SHAPES.maj;
    return { root, pcs: shape.map(i => (root + i) % 12), qual: c.qual };
  });
  // voicings for every half bar, voice-led
  let hiPrev = null, loPrev = null;
  const vo = slots.map(c => {
    const hi = voice(c.pcs, hiPrev, 63, c.pcs.length); hiPrev = hi;
    const lo = voice(c.pcs, loPrev, 56, 3); loPrev = lo;
    let bass = 36 + ((c.root - 36) % 12 + 12) % 12; if (bass < 38) bass += 12;
    return { hi, lo, bass, pcs: c.pcs, root: c.root, qual: c.qual };
  });
  const at = s => vo[Math.min(vo.length - 1, Math.floor(s / 8))];

  const melody = melodyNotes(written.melody, shift);
  const parts = [{ inst: band[0], notes: melody }];
  for (const [v, kind] of [[1, S.play[1]], [2, S.play[2]], [3, S.play[3]]]) {
    const notes = [];
    const add = (p, s, l, vel) => { if (p && s < steps) notes.push({ p, s, l: Math.max(1, Math.min(l, steps - s)), v: vel }); };
    const voicing = s => (v === 1 ? at(s).hi : at(s).lo);
    for (let s = 0; s < finalBar; s += 8) {
      const c = at(s), V = voicing(s), B = c.bass, barPos = s % 16;
      switch (kind) {
        case "pad": {
          // hold the chord, joining half bars that repeat it
          if (s > 0 && at(s - 8).root === c.root && at(s - 8).qual === c.qual) { for (const n of notes.filter(n => n.s + n.l === s)) n.l += 8; break; }
          V.forEach(p => add(p, s, 8, 0.5));
          break;
        }
        case "upper": V.slice(-2).forEach(p => add(p, s, 8, 0.55)); break;
        case "lower": add(V[0], s, 8, 0.55); break;
        case "arp": {
          const seq = [B + 12, V[0], V[1], V[2] ?? V[1]];
          for (let k = 0; k < 4; k++) add(seq[k], s + k * 2, 3, 0.5);
          break;
        }
        case "stab": V.forEach(p => { add(p, s + 2, 1, 0.55); add(p, s + 6, 1, 0.5); }); if (barPos === 0) V.forEach(p => add(p, s, 2, 0.6)); break;
        case "power8": for (let k = 0; k < 8; k += 2) [B + 12, B + 19, B + 24].forEach(p => add(p, s + k, 2, k === 0 ? 0.7 : 0.58)); break;
        case "strum": {
          const hits = barPos === 0 ? [[0, 0.72], [4, 0.6], [6, 0.48]] : [[2, 0.5], [4, 0.62], [6, 0.48]];
          for (const [k, vel] of hits) V.forEach((p, i) => add(p, s + k, 2, vel - i * 0.03));
          break;
        }
        case "pick": {  // a fingerpicked pattern: bass, then chord tones on eighths
          const seq = [B + 12, V[1], V[2] ?? V[0], V[1]];
          for (let k = 0; k < 4; k++) add(seq[k], s + k * 2, 2, 0.5);
          break;
        }
        case "comp": {  // jazz chords on the beat and the "and" of two
          const shell = V.length >= 4 ? [V[1], V[2], V[3]] : V;
          if (barPos === 0) { shell.forEach(p => add(p, s, 3, 0.52)); shell.forEach(p => add(p, s + 6, 2, 0.48)); }
          else if (Math.random() < 0.6) shell.forEach(p => add(p, s + 2, 2, 0.46));
          break;
        }
        case "comp2": V.slice(0, 3).forEach(p => add(p, s + 4, 1, 0.38)); break;  // soft chords on beats two and four
        case "pah": V.forEach(p => add(p, s + 4, 2, 0.55)); break;
        case "root": {
          if (s > 0 && at(s - 8).root === c.root) { for (const n of notes.filter(n => n.s + n.l === s)) n.l += 8; break; }
          add(B, s, 8, 0.75);
          break;
        }
        case "root8": for (let k = 0; k < 8; k += 2) add(k === 6 && barPos === 8 ? B + 12 : B, s + k, 2, k === 0 ? 0.8 : 0.66); break;
        case "rootfifth": add(B, s, 4, 0.78); add(B + 7 > 52 ? B - 5 : B + 7, s + 4, 4, 0.66); break;
        case "oom": add(B, s, 2, 0.8); break;
        case "walk": {
          // one note a beat: root, chord tone, chord tone, then a half step into the next chord
          const tones = c.pcs.map(pc => B + ((pc - B % 12) % 12 + 12) % 12), next = at(s + 8).bass;
          let pair = barPos === 0 ? [B, tones[1] ?? B + 4] : [tones[2] ?? B + 7, next === B ? tones[1] ?? B + 4 : next + (next > B ? -1 : 1)];
          pair = pair.map(q => { while (q > 55) q -= 12; while (q < 36) q += 12; return q; });
          add(pair[0], s, 4, 0.74); add(pair[1], s + 4, 4, 0.68);
          break;
        }
        default: V.forEach(p => add(p, s, 8, 0.55));
      }
    }
    // the last bar: everyone holds the final chord
    const c = at(finalBar), V = voicing(finalBar);
    if (v === 3) add(c.bass, finalBar, 16, 0.75); else V.forEach(p => add(p, finalBar, 16, 0.5));
    parts.push({ inst: band[v], notes: notes.sort((a, b) => a.s - b.s || a.p - b.p) });
  }
  return {
    steps, bars, tempo, key, minor, style, swing: S.swing || 0, parts,
    drums: { beat: drums, hits: drums ? drumHits(drums, steps, finalBar) : [] },
    written,
  };
}

export function drumHits(beat, steps, tEnd = steps) {
  const hits = [], bars = Math.ceil(tEnd / 16);
  for (let b = 0; b < bars; b++) {
    const fill = b % 4 === 3 && (b + 1) * 16 < tEnd && beat !== "jazz";
    for (const [d, list, v] of BEATS[beat]) for (const s of list) {
      const t = b * 16 + s;
      if (t < tEnd && !(fill && s >= 12)) hits.push({ d, s: t, v });
    }
    if (fill) for (const s of [12, 13, 14, 15]) hits.push({ d: beat === "cinematic" ? "tom" : "snare", s: b * 16 + s, v: 0.45 + (s - 12) * 0.12 });
    if (b % 4 === 0 && b > 0 && beat !== "jazz" && beat !== "folk") hits.push({ d: "crash", s: b * 16, v: 0.4 });
  }
  if (tEnd < steps) hits.push({ d: "crash", s: tEnd, v: 0.6 }, { d: beat === "cinematic" ? "tom" : "kick", s: tEnd, v: 0.9 });
  return hits.sort((a, b) => a.s - b.s);
}
