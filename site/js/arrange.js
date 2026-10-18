// Turns the four parts the composer wrote into a band arrangement for a style: how each part is
// played (held, repeated on eighth notes, broken into an arpeggio...) and a drum beat.
// None of this is learned; it is a fixed set of playing patterns, one per style.
import { STYLES, BEATS } from "./catalog.js";

// What each part is sounding at every sixteenth note (0 = silent).
function soundingGrid(parts, steps) {
  return parts.map(notes => {
    const a = new Array(steps).fill(0);
    for (const n of notes) for (let t = n.s; t < Math.min(steps, n.s + n.l); t++) a[t] = n.p;
    return a;
  });
}

function pattern(kind, v, parts, sound, tEnd) {
  const out = [], at = t => sound[v][t];
  const push = (p, s, l, vel) => { if (p && s < tEnd) out.push({ p, s, l: Math.max(1, Math.min(l, tEnd - s)), v: vel }); };
  switch (kind) {
    case "pad":
      return parts[v].map(n => ({ ...n, v: 0.55 }));
    case "pulse8": case "root8":
      for (let t = 0; t < tEnd; t += 2) push(at(t), t, 2, t % 4 === 0 ? 0.75 : 0.58);
      break;
    case "stab":
      for (let t = 0; t < tEnd; t += 2) if (t % 4 === 2 || t % 16 === 0) push(at(t), t, t % 16 === 0 ? 2 : 1, 0.6);
      break;
    case "comp":
      for (let t = 0; t < tEnd; t++) { const b = t % 16; if (b === 0) push(at(t), t, 3, 0.55); if (b === 6 || b === 10) push(at(t), t, 2, 0.5); }
      break;
    case "strum": {
      const vel = { 0: 0.72, 4: 0.6, 6: 0.48, 10: 0.5, 12: 0.62, 14: 0.48 };
      for (let t = 0; t < tEnd; t++) if (vel[t % 16] !== undefined) push(at(t), t, 2, vel[t % 16]);
      break;
    }
    case "arp":
      // broken chord on eighth notes: bass an octave up, low harmony, high harmony, low harmony
      for (let t = 0; t < tEnd; t += 2) {
        const order = [sound[3][t] ? sound[3][t] + 12 : 0, sound[2][t], sound[1][t], sound[2][t]];
        push(order[(t / 2) % 4] || at(t), t, 3, 0.52);
      }
      break;
    case "oom":
      for (let t = 0; t < tEnd; t += 8) push(at(t), t, 3, 0.8);
      break;
    case "pah":
      for (let t = 4; t < tEnd; t += 8) push(at(t), t, 2, 0.6);
      break;
    case "walk": {
      // a walking bass: one note a beat, moving root, fifth, octave, fifth while the harmony
      // holds, and stepping in by a half step just before the next bass note
      let run = 0;
      for (let t = 0; t < tEnd; t += 4) {
        const p = at(t); if (!p) { run = 0; continue; }
        const next = t + 4 < tEnd ? at(t + 4) : p;
        run = t > 0 && at(t - 4) === p ? run + 1 : 0;
        let q = [p, p + 7, p + 12, p + 7][run % 4];
        if (next && next !== p) q = next + (next > p ? -1 : 1);
        while (q > 60) q -= 12;
        push(q, t, 4, 0.72);
      }
      break;
    }
    default:  // "as"
      return parts[v].map(n => ({ ...n, v: v === 0 ? 0.9 : 0.72 }));
  }
  return out;
}

// written: four note lists from the composer. Returns a playable song.
export function arrange(written, { steps, style, band, drums, tempo, key, minor }) {
  const S = STYLES[style];
  const sound = soundingGrid(written, steps);
  // the final chord: from the last note start on, every part simply holds
  const tEnd = Math.max(...written.map(ns => (ns.length ? ns[ns.length - 1].s : 0)));
  const parts = written.map((notes, v) => {
    const kind = S.play[v];
    const body = kind === "as" ? pattern("as", v, written, sound, steps) : pattern(kind, v, written, sound, tEnd);
    const tail = kind === "as" || kind === "pad" ? [] : notes.filter(n => n.s + n.l > tEnd).map(n => ({ p: n.p, s: Math.max(n.s, tEnd), l: n.s + n.l - Math.max(n.s, tEnd), v: 0.72 }));
    if (kind === "pad") return { inst: band[v], notes: body };
    return { inst: band[v], notes: body.concat(tail).sort((a, b) => a.s - b.s) };
  });
  return {
    steps, bars: steps / 16, tempo, key, minor, style,
    swing: S.swing || 0,
    parts,
    drums: { beat: drums, hits: drums ? drumHits(drums, steps, tEnd) : [] },
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
