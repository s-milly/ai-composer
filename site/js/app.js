import { INSTRUMENTS, INST, PARTS, DRUM_PART, STYLES, STYLE_ORDER, KEYS, BEAT_NAMES } from "./catalog.js";
import { loadWriter, writeSong, rewriteMelody, melodyGenres } from "./writer.js";
import { loadReader, readDescription } from "./reader.js";
import { arrange } from "./arrange.js";
import * as audio from "./audio.js";
import { mountStage, setBand, light } from "./stage.js";
import { mountMaker, makerSong, loadSong, selectTrack, draw as drawMaker, playhead as makerHead, mk } from "./maker.js";
import { drawRoll, rollHead, rollTip } from "./roll.js";
import { downloadMidi } from "./midi.js";

const $ = id => document.getElementById(id);
const state = { tab: "ai", ai: null, read: null, playing: null };
const EXAMPLES = [
  "A loud, hype rock walk-up song",
  "A slow, sad piano song for a rainy night",
  "Chill late night jazz with a saxophone",
  "Epic movie music for a big battle",
  "A gentle lullaby with a harp and a music box",
  "A happy campfire song with guitar and harmonica",
  "Spooky Halloween music",
  "An upbeat dance song for a party",
];
// Keys each style tends to sit well in (major-key tonic or minor-key tonic).
const KEYS_FOR = { rock: [4, 9, 2, 7], pop: [0, 7, 2, 9], jazz: [5, 10, 3, 0], folk: [7, 2, 9, 0], march: [10, 3, 5], classical: [2, 7, 0, 9],
  ballad: [0, 5, 7, 3], cinematic: [2, 0, 7], lullaby: [5, 0, 7], spooky: [2, 9, 4] };
const pickKey = style => { const k = KEYS_FOR[style] || [0]; return k[Math.floor(Math.random() * k.length)]; };
const setStatus = s => ($("status").textContent = s);

/* ---------- Playing ---------- */
function currentSong() { return state.tab === "ai" ? state.ai && state.ai.song : makerSong(); }
function hasNotes(song) { return song && (song.parts.some(p => INST[p.inst] && p.notes.length) || song.drums.hits.length); }

async function startPlay() {
  const song = currentSong();
  if (!hasNotes(song)) return;
  try { state.playing = await audio.play(song, setStatus); }
  catch (e) { setStatus("The instrument sounds could not load. Check your connection and try again."); return; }
  state.playing.tab = state.tab;
  playButton(true);
  requestAnimationFrame(tick);
}
function stopPlay() {
  audio.stop();
  state.playing = null;
  playButton(false);
  light(null); $("progress").style.width = "0";
  rollHead($("roll"), $("roll-scroll"), null); makerHead(null);
}
function tick() {
  const p = state.playing; if (!p) return;
  const t = audio.now() - p.t0, song = p.song, dur = audio.timeOf(song, song.steps);
  if (audio.now() > p.end) { stopPlay(); return; }
  light(t >= 0 ? audio.lights(song, t) : null);
  const step = Math.max(0, t) / (60 / song.tempo / 4);
  $("progress").style.width = `${Math.min(100, (Math.max(0, t) / dur) * 100)}%`;
  if (p.tab === "ai") rollHead($("roll"), $("roll-scroll"), Math.min(step, song.steps)); else makerHead(Math.min(step, song.steps));
  requestAnimationFrame(tick);
}
function playButton(on) {
  $("play").querySelector("span").textContent = on ? "Stop" : "Play";
  $("play-icon").setAttribute("d", on ? "M2.5 2.5h9v9h-9z" : "M3 1.5v11l9-5.5z");
}
function refreshPlayable() { $("play").disabled = !hasNotes(currentSong()); }

/* ---------- Stage ---------- */
function showBand(band, drums) {
  setBand(band, drums);
  $("stage-legend").innerHTML = band.map((id, v) => `<li><span class="sw" style="background:${PARTS[v].color}"></span>${PARTS[v].name}: ${INST[id] ? INST[id].name : "off"}</li>`).join("")
    + (drums ? `<li><span class="sw" style="background:${DRUM_PART.color}"></span>Drums</li>` : "");
}
function stageForTab() {
  if (state.tab === "ai") {
    const s = state.ai ? state.ai.settings : null;
    showBand(s ? s.band : STYLES.classical.band, s ? !!s.drums : false);
  } else showBand(mk.parts.map(p => p.inst), mk.drums.hits.length > 0);
}
function pickPlayer(v) {
  if (state.tab === "mk") { selectTrack(v); $("mk-tracks").scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
  if (!state.ai) { $("prompt").focus(); return; }
  $("adjust").open = true;
  const target = v === 4 ? $("a-drums") : $(`a-part-${v}`);
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  target.focus({ preventScroll: true });
}

/* ---------- Describe a song ---------- */
function busy(on) { ["compose", "again", "reharm", "to-maker", "midi"].forEach(id => ($(id).disabled = on)); }

async function composeFrom(text) {
  const r = readDescription(text);
  state.read = r;
  const style = r.style.value;
  const settings = { style, minor: r.minor, key: r.key ?? pickKey(style), bars: r.bars, tempo: r.tempo, creativity: r.creativity,
    band: r.band, drums: r.drums, speed: r.speed.value };
  await runCompose(settings, null);
}

// Which genre the models write in for a style, and how busy the melody is (0 to 2).
function writing(s) {
  const S = STYLES[s.style], trained = melodyGenres();
  const dens = Math.max(0, Math.min(2, ["slow", "medium", "fast"].indexOf(s.speed) + S.dens));
  return { genre: S.genre, melodyGenre: trained.includes(S.genre) ? S.genre : "pop", minor: s.minor, bars: s.bars, dens, temp: s.creativity };
}

async function runCompose(settings, keepChords) {
  if (state.playing) stopPlay();
  busy(true);
  setStatus("Writing the song…");
  const w = writing(settings), onProgress = msg => setStatus(`${msg}…`);
  const written = keepChords ? await rewriteMelody(state.ai.written, w) : await writeSong({ ...w, onProgress });
  state.ai = { settings: { ...settings }, written };
  $("heard").hidden = false; $("roll-wrap").hidden = false;
  rebuild();
  busy(false);
  renderHeard();
  syncAdjust();
  setStatus("");
  startPlay();
}

function rebuild() {
  const { settings: s, written } = state.ai;
  state.ai.song = arrange(written, { style: s.style, band: s.band, drums: s.drums, tempo: s.tempo, key: s.key, minor: s.minor });
  showBand(s.band, !!s.drums);
  drawRoll($("roll"), $("roll-scroll"), state.ai.song);
  $("roll-title").textContent = `The notes · ${KEYS[s.key]} ${s.minor ? "minor" : "major"} · ${s.bars} bars`;
  $("roll-key").innerHTML = PARTS.map((p, v) => `<li><span class="sw" style="background:${p.color};opacity:${INST[s.band[v]] ? 1 : 0.25}"></span>${p.name}</li>`).join("");
  refreshPlayable();
}
// Changes that only re-arrange the same notes: restart playback so they are heard at once.
function rearrange() {
  const was = !!state.playing;
  if (was) stopPlay();
  rebuild(); renderHeard();
  if (was) startPlay();
}

const q = w => `<q>${w}</q>`;
const list = ws => ws.map(q).join(", ");
function why(a, fallback) {
  if (a.how === "said") return `You said ${list(a.words)}`;
  if (a.how === "style") return fallback;
  if (a.how === "model" && a.words.length) return `The model's guess from ${list(a.words)}${a.conf ? ` (${Math.round(a.conf * 100)}% sure)` : ""}`;
  return "No clues, so the model's best starting point";
}
function renderHeard() {
  const r = state.read, s = state.ai.settings, S = STYLES[s.style];
  const moodName = { bright: "Bright", sad: "Sad", dark: "Dark" }[r.mood.value];
  const secs = Math.round((s.bars * 4 * 60) / s.tempo);
  const styleChanged = s.style !== r.style.value;
  const items = [
    ["Style", S.name, styleChanged ? "You picked it below" : why(r.style)],
    ["Mood", `${moodName}, ${s.minor ? "minor" : "major"} key`, why(r.mood, `${S.name} songs use a minor key`)],
    ["Speed", `${{ slow: "Slow", medium: "Medium", fast: "Fast" }[r.speed.value]} · ${s.tempo} bpm`, why(r.speed)],
    ["Length", `${s.bars} bars · about ${secs} seconds`, r.tokens.some(t => ["short", "long", "bars"].includes(t)) ? "From your description" : "Say short or long to change it"],
  ];
  const bandText = s.band.map(id => (INST[id] ? INST[id].name : "off")).join(" · ") + (s.drums ? ` · ${BEAT_NAMES[s.drums]} drums` : "");
  const bandWhy = r.named.length ? `You named ${list(r.named.map(id => INST[id].name.toLowerCase()))}` : `The usual ${S.name.toLowerCase()} band`;
  $("heard-list").innerHTML = items.map(([k, v, w]) => `<li><span class="k">${k}</span><span class="v">${v}</span><span class="why">${w}</span></li>`).join("")
    + `<li style="grid-column:1/-1"><span class="k">Band</span><span class="band-v">${bandText}</span><span class="why">${bandWhy}. Select a player on stage to change it.</span></li>`;
  $("heard-notes").textContent = r.notes.join(" ");
  $("heard-notes").hidden = !r.notes.length;
}

function syncAdjust() {
  const s = state.ai.settings;
  $("a-style").value = s.style;
  $("a-drums").value = s.drums || "";
  $("a-key").value = s.key;
  $("a-mode").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.v === +s.minor)));
  $("a-bars").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.v === s.bars)));
  $("a-tempo").value = s.tempo; $("a-tempo-out").textContent = `${s.tempo} bpm`;
  $("a-temp").value = s.creativity; $("a-temp-out").textContent = (+s.creativity).toFixed(2);
  s.band.forEach((id, v) => ($(`a-part-${v}`).value = INST[id] ? id : "off"));
}

function mountAdjust() {
  const instOptions = INSTRUMENTS.map(i => `<option value="${i.id}">${i.name}</option>`).join("") + `<option value="off">Off</option>`;
  $("a-style").innerHTML = STYLE_ORDER.map(k => `<option value="${k}">${STYLES[k].name}</option>`).join("");
  $("a-drums").innerHTML = `<option value="">No drums</option>` + Object.entries(BEAT_NAMES).map(([k, n]) => `<option value="${k}">${n}</option>`).join("");
  $("a-key").innerHTML = KEYS.map((k, i) => `<option value="${i}">${k}</option>`).join("");
  $("a-band").innerHTML = PARTS.map((p, v) => `<div class="field"><span class="lab"><label for="a-part-${v}"><span class="sw" style="background:${p.color}"></span>${p.name}</label></span><select id="a-part-${v}" data-v="${v}">${instOptions}</select></div>`).join("");
  const s = () => state.ai.settings;
  $("a-style").addEventListener("change", e => {
    const st = STYLES[e.target.value];
    Object.assign(s(), { style: e.target.value, band: st.band.slice(), drums: st.drums, tempo: st.tempo[["slow", "medium", "fast"].indexOf(s().speed)] });
    syncAdjust(); rearrange();
  });
  $("a-drums").addEventListener("change", e => { s().drums = e.target.value || null; rearrange(); });
  $("a-key").addEventListener("change", e => { s().key = +e.target.value; rearrange(); });
  $("a-tempo").addEventListener("input", e => { s().tempo = +e.target.value; $("a-tempo-out").textContent = `${s().tempo} bpm`; });
  $("a-tempo").addEventListener("change", () => rearrange());
  $("a-temp").addEventListener("input", e => { s().creativity = +e.target.value; $("a-temp-out").textContent = (+e.target.value).toFixed(2); });
  $("a-band").addEventListener("change", e => { s().band[+e.target.dataset.v] = e.target.value; rearrange(); });
  const seg = (id, fn) => $(id).addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; fn(+b.dataset.v); syncAdjust(); });
  seg("a-mode", v => (s().minor = !!v));
  seg("a-bars", v => (s().bars = v));
}

/* ---------- Tabs ---------- */
function setTab(tab) {
  if (state.tab === tab) return;
  if (state.playing) stopPlay();
  state.tab = tab;
  for (const [t, id] of [["ai", "tab-ai"], ["mk", "tab-mk"]]) {
    $(id).setAttribute("aria-selected", String(t === tab)); $(id).tabIndex = t === tab ? 0 : -1;
  }
  $("pane-ai").hidden = tab !== "ai"; $("pane-mk").hidden = tab !== "mk";
  if (tab === "mk") drawMaker();
  stageForTab(); refreshPlayable();
}

const FACTS = [
  ["2,404", "songs and solos the composer learned from, in 5 genres"],
  ["1,098", "jazz standards it learned chord changes from"],
  ["5,521", "descriptions by musicians the reader learned from"],
  [INSTRUMENTS.length, "instruments to choose from, no vocals"],
];

/* ---------- Start ---------- */
function init() {
  mountStage($("stage"), pickPlayer);
  stageForTab();
  mountAdjust();
  mountMaker($("pane-mk"), { onChange: () => { if (state.tab === "mk") { stageForTab(); refreshPlayable(); } } });
  $("examples").innerHTML = EXAMPLES.map(t => `<button type="button">${t}</button>`).join("");
  $("examples").addEventListener("click", e => { const b = e.target.closest("button"); if (!b || $("compose").disabled) return; $("prompt").value = b.textContent; composeFrom(b.textContent); });
  $("ask").addEventListener("submit", e => {
    e.preventDefault();
    const text = $("prompt").value.trim() || $("prompt").placeholder;
    if (!$("prompt").value.trim()) $("prompt").value = text;
    composeFrom(text);
  });
  $("prompt").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("ask").requestSubmit(); } });
  $("again").addEventListener("click", () => runCompose(state.ai.settings, null));
  $("reharm").addEventListener("click", () => runCompose(state.ai.settings, true));
  $("to-maker").addEventListener("click", () => { loadSong(state.ai.song); setTab("mk"); $("tab-mk").scrollIntoView({ block: "start", behavior: "smooth" }); });
  $("midi").addEventListener("click", () => { const s = state.ai.settings; downloadMidi(state.ai.song, `ai-composer-${STYLES[s.style].name.split(" ")[0].toLowerCase()}-${KEYS[s.key].replace("#", "sharp")}-${s.minor ? "minor" : "major"}.mid`); });
  $("mk-midi").addEventListener("click", () => downloadMidi(makerSong(), "my-song.mid"));
  $("play").addEventListener("click", () => (state.playing ? stopPlay() : startPlay()));
  $("tab-ai").addEventListener("click", () => setTab("ai"));
  $("tab-mk").addEventListener("click", () => setTab("mk"));
  $("tab-ai").parentElement.addEventListener("keydown", e => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = state.tab === "ai" ? "mk" : "ai"; setTab(next); $(`tab-${next}`).focus();
  });
  $("roll").addEventListener("pointermove", e => rollTip(e, state.ai && state.ai.song, $("roll-tip"), $("roll-scroll").parentElement));
  $("roll").addEventListener("pointerleave", () => $("roll-tip").classList.remove("on"));

  $("facts").innerHTML = FACTS.map(([b, t]) => `<li><b>${b}</b><span>${t}</span></li>`).join("");
  let w = innerWidth;
  addEventListener("resize", () => {
    if (innerWidth === w) return; w = innerWidth;
    if (state.ai) drawRoll($("roll"), $("roll-scroll"), state.ai.song);
    if (state.tab === "mk") drawMaker();
    stageForTab();
  });
  Promise.all([loadWriter(), loadReader()]).then(() => {
    $("compose").disabled = false;
    setStatus("Describe a song, or pick an example.");
    refreshPlayable();
  }).catch(() => setStatus("The models could not load. Refresh the page to try again."));
}
init();
