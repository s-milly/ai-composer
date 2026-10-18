// Saves a song as a standard MIDI file: one track per part, drums on the General MIDI drum channel.
import { INST, PARTS } from "./catalog.js";

const DRUM_NOTES = { kick: 36, snare: 38, clap: 39, hat: 42, open: 46, tom: 45, crash: 49, ride: 51 };

export function midiBytes(song) {
  const TPQ = 480, per = TPQ / 4;
  const tick = s => Math.round((s + (song.swing && Math.round(s) % 4 === 2 ? song.swing : 0)) * per);
  const vlq = n => { const b = [n & 127]; while ((n >>= 7)) b.unshift((n & 127) | 128); return b; };
  const str = s => [...s].map(c => c.charCodeAt(0) & 127);
  const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (type, data) => [...str(type), ...u32(data.length), ...data];
  const usPerQ = Math.round(60e6 / song.tempo);
  const tracks = [chunk("MTrk", [0, 255, 81, 3, (usPerQ >> 16) & 255, (usPerQ >> 8) & 255, usPerQ & 255, 0, 255, 88, 4, 4, 2, 24, 8, 0, 255, 47, 0])];
  const track = (name, ch, prog, ev) => {
    ev.sort((a, b) => a[0] - b[0] || (a[1] & 0xf0) - (b[1] & 0xf0));
    const n = str(name), data = [0, 255, 3, n.length, ...n];
    if (prog != null) data.push(0, 0xC0 | ch, prog);
    let last = 0;
    for (const [t, s, p, vel] of ev) { data.push(...vlq(t - last), s, p, vel); last = t; }
    data.push(0, 255, 47, 0);
    tracks.push(chunk("MTrk", data));
  };
  song.parts.forEach((part, v) => {
    const inst = INST[part.inst]; if (!inst || !part.notes.length) return;
    const ev = [];
    for (const n of part.notes) {
      const vel = Math.round(40 + 70 * (n.v ?? 0.8));
      ev.push([tick(n.s), 0x90 | v, n.p, vel], [Math.max(tick(n.s) + 1, tick(n.s + n.l)), 0x80 | v, n.p, 0]);
    }
    track(`${PARTS[v].name} (${inst.name})`, v, inst.prog, ev);
  });
  if (song.drums.hits.length) {
    const ev = [];
    for (const h of song.drums.hits) { const t = tick(h.s); ev.push([t, 0x99, DRUM_NOTES[h.d], Math.round(40 + 80 * (h.v ?? 0.8))], [t + per, 0x89, DRUM_NOTES[h.d], 0]); }
    track("Drums", 9, null, ev);
  }
  return new Uint8Array([...chunk("MThd", [0, 1, 0, tracks.length, (TPQ >> 8) & 255, TPQ & 255]), ...tracks.flat()]);
}

export function downloadMidi(song, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([midiBytes(song)], { type: "audio/midi" }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
