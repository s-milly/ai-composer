// Song Maker: write your own song by placing notes on a grid, one track per part plus drums.
// No AI here; the notes are exactly what you place.
import { INSTRUMENTS, INST, PARTS, DRUM_PART, DRUM_ROWS, BEATS, BEAT_NAMES, KEYS, noteName, scaleOf } from "./catalog.js";
import { drumHits } from "./arrange.js";
import * as audio from "./audio.js";

const RANGES = [[55, 84], [50, 79], [43, 72], [28, 57]];  // lowest and highest note on each track's grid
const LENGTHS = [[1, "1/16"], [2, "1/8"], [4, "1/4"], [8, "1/2"], [16, "1"]];
const STORE = "ai-composer.maker.v1";

const empty = () => ({
  tempo: 100, bars: 8, key: 0, minor: false, showScale: true, len: 4, track: 0,
  parts: [{ inst: "acoustic_grand_piano", notes: [] }, { inst: "acoustic_guitar_nylon", notes: [] },
    { inst: "string_ensemble_1", notes: [] }, { inst: "electric_bass_finger", notes: [] }],
  drums: { beat: null, hits: [] },
});

export const mk = load();
let el = {}, history = [], onChange = () => {};

function load() {
  try { const s = JSON.parse(localStorage.getItem(STORE)); if (s && s.parts && s.parts.length === 4) return { ...empty(), ...s }; } catch (e) { /* storage blocked */ }
  return empty();
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(mk)); } catch (e) { /* storage blocked */ } }
function remember() { history.push(JSON.stringify({ parts: mk.parts, drums: mk.drums })); if (history.length > 60) history.shift(); el.undo.disabled = false; }
function changed() { save(); draw(); onChange(); }

// The maker's song, in the same shape the player uses.
export function makerSong() {
  const steps = mk.bars * 16;
  return {
    steps, bars: mk.bars, tempo: mk.tempo, key: mk.key, minor: mk.minor, swing: mk.drums.beat === "jazz" ? 0.66 : 0,
    parts: mk.parts.map(p => ({ inst: p.inst, notes: p.notes.filter(n => n.s < steps).map(n => ({ ...n, l: Math.min(n.l, steps - n.s), v: n.v ?? 0.8 })).sort((a, b) => a.s - b.s) })),
    drums: { beat: mk.drums.beat, hits: mk.drums.hits.filter(h => h.s < steps).sort((a, b) => a.s - b.s) },
  };
}

// Copy a finished song (for example the AI's) into the maker so it can be edited.
export function loadSong(song) {
  remember();
  Object.assign(mk, {
    tempo: song.tempo, bars: song.bars, key: song.key, minor: song.minor,
    parts: song.parts.map(p => ({ inst: p.inst, notes: p.notes.map(n => ({ p: n.p, s: n.s, l: n.l, v: n.v })) })),
    drums: { beat: song.drums.beat, hits: song.drums.hits.map(h => ({ ...h })) },
  });
  syncControls(); changed();
}

export function selectTrack(v) { mk.track = v; save(); draw(); syncControls(); }

const cell = () => (innerWidth < 640 ? { cw: 20, rh: 20 } : { cw: 16, rh: 15 });
const HEAD = 22, LABEL = 52;

export function draw() {
  if (!el.grid) return;
  const { cw, rh } = cell(), steps = mk.bars * 16, v = mk.track, drums = v === 4;
  const rows = drums ? DRUM_ROWS.map(([id, name]) => ({ id, name })) : [];
  if (!drums) for (let p = RANGES[v][1]; p >= RANGES[v][0]; p--) rows.push({ p, name: noteName(p) });
  const w = steps * cw, h = HEAD + rows.length * rh;
  const scale = scaleOf(mk.key, mk.minor), color = drums ? DRUM_PART.color : PARTS[v].color;
  let g = "", k = "";
  rows.forEach((r, i) => {
    const y = HEAD + i * rh;
    const black = !drums && [1, 3, 6, 8, 10].includes(r.p % 12);
    const out = !drums && mk.showScale && !scale.has(r.p % 12);
    const fill = out ? "var(--mk-out)" : black ? "var(--mk-black)" : "var(--mk-white)";
    g += `<rect x="0" y="${y}" width="${w}" height="${rh}" fill="${fill}"/>`;
    if (!drums && r.p % 12 === mk.key % 12) g += `<rect x="0" y="${y}" width="${w}" height="${rh}" fill="var(--mk-home)"/>`;
    const bold = drums || r.p % 12 === 0;
    k += `<rect x="0" y="${y}" width="${LABEL}" height="${rh}" fill="${out ? "var(--mk-out)" : black ? "var(--mk-black)" : "var(--mk-white)"}"/>`;
    k += `<text x="${LABEL - 8}" y="${y + rh / 2 + 4}" text-anchor="end" font-size="${drums ? 11.5 : 10.5}" font-weight="${bold ? 600 : 400}" fill="${out ? "var(--muted)" : "var(--ink-2)"}">${r.name}</text>`;
  });
  for (let s = 0; s <= steps; s++) {
    const bar = s % 16 === 0, beat = s % 4 === 0;
    g += `<line x1="${s * cw}" x2="${s * cw}" y1="${HEAD}" y2="${h}" stroke="${bar ? "var(--axis)" : beat ? "var(--mk-beat)" : "var(--mk-six)"}" stroke-width="${bar ? 1.5 : 1}"/>`;
    if (bar && s < steps) g += `<text x="${s * cw + 4}" y="15" font-size="11" fill="var(--muted)">${s / 16 + 1}</text>`;
  }
  if (drums) {
    for (const hh of mk.drums.hits) {
      const i = rows.findIndex(r => r.id === hh.d); if (i < 0 || hh.s >= steps) continue;
      g += `<rect class="nt" x="${hh.s * cw + 2}" y="${HEAD + i * rh + 2}" width="${cw - 4}" height="${rh - 4}" rx="3" fill="${color}" opacity="${0.45 + 0.55 * (hh.v ?? 0.8)}"/>`;
    }
  } else {
    const [lo, hi] = RANGES[v], y = p => HEAD + (hi - p) * rh;
    // the other tracks, faintly, so chords can be lined up
    mk.parts.forEach((part, u) => {
      if (u === v) return;
      for (const n of part.notes) if (n.p >= lo && n.p <= hi && n.s < steps)
        g += `<rect x="${n.s * cw + 1}" y="${y(n.p) + 1}" width="${Math.max(2, n.l * cw - 2)}" height="${rh - 2}" rx="2" fill="none" stroke="${PARTS[u].color}" stroke-opacity=".45" stroke-dasharray="3 2"/>`;
    });
    for (const n of mk.parts[v].notes) if (n.p >= lo && n.p <= hi && n.s < steps)
      g += `<rect class="nt" x="${n.s * cw + 1}" y="${y(n.p) + 1}" width="${Math.max(3, Math.min(n.l, steps - n.s) * cw - 2)}" height="${rh - 2}" rx="3" fill="${color}"/>`;
  }
  g += `<line id="mk-head" x1="0" x2="0" y1="${HEAD - 4}" y2="${h}" stroke="var(--ink)" stroke-width="2" opacity="0"/>`;
  el.grid.setAttribute("width", w); el.grid.setAttribute("height", h); el.grid.setAttribute("viewBox", `0 0 ${w} ${h}`);
  el.grid.innerHTML = g;
  el.keys.setAttribute("width", LABEL); el.keys.setAttribute("height", h); el.keys.setAttribute("viewBox", `0 0 ${LABEL} ${h}`);
  el.keys.innerHTML = `<rect width="${LABEL}" height="${HEAD}" fill="var(--surface)"/>` + k;
  el.grid._rows = rows; el.grid._cw = cw; el.grid._rh = rh;
  const empty = mk.parts.every(p => !p.notes.length) && !mk.drums.hits.length;
  el.hint.hidden = !empty;
  drawTracks();
}

function drawTracks() {
  const tracks = [...PARTS.map((p, v) => ({ v, name: p.name, color: p.color, inst: INST[mk.parts[v].inst] ? INST[mk.parts[v].inst].name : "Off", n: mk.parts[v].notes.length })),
    { v: 4, name: DRUM_PART.name, color: DRUM_PART.color, inst: mk.drums.beat ? BEAT_NAMES[mk.drums.beat] + " beat" : "Drum kit", n: mk.drums.hits.length }];
  el.tracks.innerHTML = tracks.map(t => `<button type="button" class="trk" data-v="${t.v}" aria-pressed="${t.v === mk.track}">
    <span class="sw" style="background:${t.color}"></span><span class="trk-name">${t.name}</span><span class="trk-inst">${t.inst}</span><span class="trk-n">${t.n || ""}</span></button>`).join("");
}

function syncControls() {
  const v = mk.track;
  el.instWrap.hidden = v === 4; el.beatWrap.hidden = v !== 4;
  if (v < 4) el.inst.value = mk.parts[v].inst;
  el.tempo.value = mk.tempo; el.tempoOut.textContent = `${mk.tempo} bpm`;
  el.key.value = mk.key; el.scale.checked = mk.showScale;
  el.mode.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.v === +mk.minor)));
  el.bars.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.v === mk.bars)));
  el.len.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.v === mk.len)));
  el.lenWrap.hidden = v === 4;
}

/* ---------- Placing notes ---------- */
let drag = null;
function at(e) {
  const r = el.grid.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  return { s: Math.floor(x / el.grid._cw), i: Math.floor((y - HEAD) / el.grid._rh) };
}
// A finger on a phone might be scrolling the grid, so touch places a note only on a clean tap.
let tap = null;
function down(e) {
  if (e.button > 0) return;
  if (e.pointerType === "touch") { tap = { x: e.clientX, y: e.clientY }; return; }
  act(e, true);
}
function act(e, canDrag) {
  const { s, i } = at(e), rows = el.grid._rows, steps = mk.bars * 16;
  if (i < 0 || i >= rows.length || s < 0 || s >= steps) return;
  e.preventDefault();
  if (mk.track === 4) {
    const d = rows[i].id, hits = mk.drums.hits, j = hits.findIndex(h => h.d === d && h.s === s);
    remember();
    if (j >= 0) hits.splice(j, 1); else { hits.push({ d, s, v: 0.8 }); audio.preview("drums", d); }
    changed(); return;
  }
  const notes = mk.parts[mk.track].notes, p = rows[i].p;
  const j = notes.findIndex(n => n.p === p && s >= n.s && s < n.s + n.l);
  remember();
  if (j >= 0) { notes.splice(j, 1); changed(); return; }
  const n = { p, s, l: Math.min(mk.len, steps - s), v: 0.8 };
  notes.push(n);
  if (canDrag) { drag = { n, from: s }; el.grid.setPointerCapture(e.pointerId); } else save();
  audio.preview(mk.parts[mk.track].inst, p, n.l / 4);
  draw();
}
function move(e) {
  if (!drag) return;
  const { s } = at(e), steps = mk.bars * 16;
  const l = Math.max(1, Math.min(steps - drag.n.s, s - drag.n.s + 1));
  if (s > drag.from && l !== drag.n.l) { drag.n.l = l; draw(); }
}
function up(e) {
  if (tap) { if (Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 10) act(e, false); tap = null; return; }
  if (drag) { drag = null; changed(); }
}
function cancel() { tap = null; if (drag) { drag = null; changed(); } }

/* ---------- Playhead ---------- */
export function playhead(step) {
  const line = el.grid && el.grid.querySelector("#mk-head"); if (!line) return;
  if (step == null) { line.setAttribute("opacity", 0); return; }
  const x = step * el.grid._cw;
  line.setAttribute("x1", x); line.setAttribute("x2", x); line.setAttribute("opacity", 1);
  const sc = el.scroll, left = x + LABEL;
  if (left > sc.scrollLeft + sc.clientWidth - 40 || left < sc.scrollLeft + LABEL) sc.scrollLeft = left - LABEL - 60;
}

/* ---------- Setup ---------- */
export function mountMaker(root, hooks) {
  onChange = hooks.onChange;
  const q = s => root.querySelector(s);
  el = {
    grid: q("#mk-grid"), keys: q("#mk-keys"), scroll: q("#mk-scroll"), tracks: q("#mk-tracks"), hint: q("#mk-hint"),
    inst: q("#mk-inst"), instWrap: q("#mk-inst-wrap"), beatWrap: q("#mk-beat-wrap"), beat: q("#mk-beat"),
    tempo: q("#mk-tempo"), tempoOut: q("#mk-tempo-out"), key: q("#mk-key"), mode: q("#mk-mode"), scale: q("#mk-scale"),
    bars: q("#mk-bars"), len: q("#mk-len"), lenWrap: q("#mk-len-wrap"), undo: q("#mk-undo"),
  };
  el.inst.innerHTML = INSTRUMENTS.map(i => `<option value="${i.id}">${i.name}</option>`).join("") + `<option value="off">Off</option>`;
  el.beat.innerHTML = Object.entries(BEAT_NAMES).map(([id, name]) => `<option value="${id}">${name}</option>`).join("");
  el.key.innerHTML = KEYS.map((k, i) => `<option value="${i}">${k}</option>`).join("");
  el.len.innerHTML = LENGTHS.map(([s, name]) => `<button type="button" data-v="${s}" aria-label="${{ 1: "Sixteenth", 2: "Eighth", 4: "Quarter", 8: "Half", 16: "Whole" }[s]} note">${name}</button>`).join("");

  el.tracks.addEventListener("click", e => { const b = e.target.closest(".trk"); if (b) selectTrack(+b.dataset.v); });
  el.inst.addEventListener("change", () => { mk.parts[mk.track].inst = el.inst.value; changed(); if (INST[el.inst.value]) audio.preview(el.inst.value, 60, 1); });
  q("#mk-beat-fill").addEventListener("click", () => {
    remember(); mk.drums.beat = el.beat.value; mk.drums.hits = drumHits(el.beat.value, mk.bars * 16).filter(h => h.s < mk.bars * 16); changed();
  });
  el.tempo.addEventListener("input", () => { mk.tempo = +el.tempo.value; el.tempoOut.textContent = `${mk.tempo} bpm`; save(); });
  el.tempo.addEventListener("change", () => onChange());
  el.key.addEventListener("change", () => { mk.key = +el.key.value; changed(); });
  el.scale.addEventListener("change", () => { mk.showScale = el.scale.checked; changed(); });
  const seg = (box, fn) => box.addEventListener("click", e => { const b = e.target.closest("button"); if (b) { fn(+b.dataset.v); syncControls(); changed(); } });
  seg(el.mode, v => (mk.minor = !!v));
  seg(el.bars, v => (mk.bars = v));
  seg(el.len, v => (mk.len = v));
  el.undo.addEventListener("click", () => {
    const last = history.pop(); if (!last) return;
    Object.assign(mk, JSON.parse(last)); el.undo.disabled = !history.length; changed();
  });
  q("#mk-clear").addEventListener("click", () => {
    remember();
    if (mk.track === 4) mk.drums = { beat: null, hits: [] }; else mk.parts[mk.track].notes = [];
    changed();
  });
  q("#mk-clear-all").addEventListener("click", () => {
    if (!confirm("Clear every track? You can still undo.")) return;
    remember(); mk.parts.forEach(p => (p.notes = [])); mk.drums = { beat: null, hits: [] }; changed();
  });
  el.grid.addEventListener("pointerdown", down);
  el.grid.addEventListener("pointermove", move);
  el.grid.addEventListener("pointerup", up);
  el.grid.addEventListener("pointercancel", cancel);
  el.undo.disabled = true;
  syncControls(); draw();
}
