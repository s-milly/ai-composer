// Reads a song description and turns it into settings for the composer and the band.
//
// Two layers:
//  1. Words that say what they want outright ("jazz", "sad", "fast", "piano", "no drums",
//     "120 bpm", "in D minor") are read as-is.
//  2. Everything else goes to a model trained on 5,521 MusicCaps descriptions written by
//     musicians. It is a linear classifier on the average GloVe word vector, so its score for an
//     answer is the average of per-word scores; reader.bin stores those scores for 38,427 words.
import { STYLES, INST, CHORDAL } from "./catalog.js";

let R = null;

export async function loadReader(base = "site/") {
  const [meta, buf] = await Promise.all([
    fetch(base + "reader.json").then(r => r.json()),
    fetch(base + "reader.bin").then(r => r.arrayBuffer()),
  ]);
  const q = new Int8Array(buf), n = meta.order.length;
  R = { ...meta, q, n, index: new Map(meta.words.map((w, i) => [w, i])), stopSet: new Set(meta.stop) };
}
export const readerReady = () => !!R;

const TOKEN = /[a-z0-9&'-]+/g;
export const tokensOf = text => (text.toLowerCase().replace(/’/g, "'").match(TOKEN) || []);

// Words that set something directly (length, key, tempo, solo) or say nothing about the music.
// They are kept away from the model so they cannot tip its guesses.
const FILLER = new Set(["song", "songs", "music", "track", "tune", "tunes", "piece", "bars", "bar", "measures", "bpm", "beats", "minute",
  "major", "minor", "key", "sharp", "flat", "solo", "only", "just", "alone", "unaccompanied", "itself", "nothing", "really", "very", "pretty", "kind", "sort", "like",
  "something", "want", "make", "play", "write", "please", "maybe", "little", "lot", "bit", "sounds", "sounding", "feel", "feeling", "vibe", "vibes", "type",
  "minutes", "min", "mins", "seconds", "second", "sec", "secs", "short", "long", "longer", "brief", "extended", "full", "half"]);
const usable = t => !R.stopSet.has(t) && R.index.has(t) && !FILLER.has(t) && !/^\d+$/.test(t) && t.length > 1;

// The trained model: probabilities for each answer to one question, plus the words behind the winner.
function modelAnswer(head, toks) {
  const classes = R.heads[head];
  const cols = classes.map(c => R.order.indexOf(`${head}:${c}`));
  const used = toks.filter(usable);
  const sum = cols.map(() => 0), per = [];
  for (const t of used) {
    const i = R.index.get(t), s = cols.map(c => R.q[i * R.n + c] * R.scale[c]);
    s.forEach((v, k) => (sum[k] += v));
    per.push([t, s]);
  }
  const score = cols.map((c, k) => (used.length ? sum[k] / used.length : 0) + R.bias[c]);
  const m = Math.max(...score), e = score.map(v => Math.exp(v - m)), z = e.reduce((a, b) => a + b, 0);
  const prob = e.map(v => v / z);
  const best = prob.indexOf(Math.max(...prob));
  // words that pushed hardest toward the winner compared with the other answers
  const words = per.map(([t, s]) => [t, s[best] - s.reduce((a, b) => a + b, 0) / s.length])
    .filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const seen = new Set(), top = [];
  for (const [t] of words) if (!seen.has(t) && top.length < 3) { seen.add(t); top.push(t); }
  return { value: classes[best], conf: prob[best], probs: Object.fromEntries(classes.map((c, k) => [c, prob[k]])), words: top, clues: used.length };
}

/* ---------- Words read as-is ---------- */
const STYLE_WORDS = {
  classical: ["classical", "baroque", "bach", "chorale", "hymn", "hymns", "chamber", "quartet", "symphony", "opera", "church music"],
  ballad: ["ballad", "ballads", "love song", "r&b", "soul", "slow jam"],
  pop: ["pop", "dance", "edm", "techno", "house music", "disco", "club", "electronic", "hip hop", "hip-hop", "rap", "trap", "funk", "funky", "synthwave"],
  rock: ["rock", "metal", "punk", "grunge", "heavy metal", "hard rock"],
  jazz: ["jazz", "jazzy", "swing", "blues", "bluesy", "lounge", "bossa", "bebop"],
  folk: ["folk", "country", "bluegrass", "celtic", "americana", "western"],
  march: ["march", "marching", "parade", "military", "fanfare"],
  cinematic: ["cinematic", "soundtrack", "movie", "film", "epic", "orchestral", "score", "trailer"],
  lullaby: ["lullaby", "lullabies", "nursery", "meditation", "ambient", "bedtime"],
  spooky: ["spooky", "scary", "creepy", "horror", "halloween", "haunted", "eerie"],
};
const MOOD_WORDS = {
  bright: ["happy", "cheerful", "joyful", "joyous", "fun", "playful", "uplifting", "bright", "sunny", "hopeful", "triumphant", "celebratory", "excited", "excitement", "glad", "victorious", "festive"],
  sad: ["sad", "sadder", "melancholy", "melancholic", "sorrowful", "heartbroken", "heartbreak", "heartbreaking", "lonely", "gloomy", "mournful", "tearful", "crying", "grief", "depressing", "somber", "sombre", "bittersweet"],
  dark: ["dark", "scary", "spooky", "creepy", "eerie", "ominous", "sinister", "haunted", "haunting", "evil", "menacing", "mysterious", "tense", "suspenseful", "horror", "angry", "villain"],
};
const SPEED_WORDS = {
  fast: ["fast", "faster", "quick", "upbeat", "uptempo", "up-tempo", "energetic", "hype", "hyped", "pumped", "intense", "lively", "racing", "speedy", "rapid", "frantic", "aggressive"],
  slow: ["slow", "slower", "calm", "relaxing", "relaxed", "peaceful", "gentle", "sleepy", "lazy", "mellow", "chill", "soothing", "dreamy", "tranquil", "quiet"],
  medium: ["medium", "moderate", "steady", "mid-tempo", "midtempo"],
};

// Instrument names. A function picks a version to fit the style ("guitar" in a rock song is a rock guitar).
const GUITAR = s => ({ rock: "overdriven_guitar", pop: "electric_guitar_clean", jazz: "electric_guitar_clean", folk: "acoustic_guitar_steel" }[s] || "acoustic_guitar_nylon");
const INSTRUMENT_WORDS = [
  ["electric piano", "electric_piano_1"], ["rhodes", "electric_piano_1"], ["grand piano", "acoustic_grand_piano"],
  ["piano", "acoustic_grand_piano"], ["keyboard", "acoustic_grand_piano"], ["keys", "acoustic_grand_piano"],
  ["harpsichord", "harpsichord"], ["celesta", "celesta"], ["organ", "church_organ"], ["accordion", "accordion"],
  ["music box", "music_box"], ["glockenspiel", "glockenspiel"], ["bells", "glockenspiel"], ["vibraphone", "vibraphone"],
  ["vibes", "vibraphone"], ["marimba", "marimba"], ["xylophone", "xylophone"], ["steel drums", "steel_drums"],
  ["steel drum", "steel_drums"], ["steel pan", "steel_drums"],
  ["classical guitar", "acoustic_guitar_nylon"], ["nylon guitar", "acoustic_guitar_nylon"], ["acoustic guitar", "acoustic_guitar_steel"],
  ["rock guitar", "overdriven_guitar"], ["distorted guitar", "overdriven_guitar"], ["electric guitar", "electric_guitar_clean"],
  ["guitars", GUITAR], ["guitar", GUITAR], ["banjo", "banjo"], ["harp", "orchestral_harp"], ["fiddle", "violin"],
  ["violins", "violin"], ["violin", "violin"], ["viola", "viola"], ["cellos", "cello"], ["cello", "cello"],
  ["double bass", "contrabass"], ["contrabass", "contrabass"], ["upright bass", "acoustic_bass"], ["bass guitar", "electric_bass_finger"],
  ["electric bass", "electric_bass_finger"], ["synth bass", "synth_bass_1"],
  ["string section", "string_ensemble_1"], ["strings", "string_ensemble_1"], ["orchestra", "string_ensemble_1"],
  ["pizzicato", "pizzicato_strings"], ["flutes", "flute"], ["flute", "flute"], ["oboe", "oboe"], ["clarinet", "clarinet"],
  ["bassoon", "bassoon"], ["tenor sax", "tenor_sax"], ["saxophone", "alto_sax"], ["sax", "alto_sax"], ["harmonica", "harmonica"],
  ["trumpets", "trumpet"], ["trumpet", "trumpet"], ["brass", "brass_section"], ["french horn", "french_horn"], ["horns", "french_horn"],
  ["horn", "french_horn"], ["trombone", "trombone"], ["tuba", "tuba"], ["timpani", "timpani"],
  ["synth pad", "pad_2_warm"], ["synthesizer", "lead_2_sawtooth"], ["synths", "lead_2_sawtooth"], ["synth", "lead_2_sawtooth"],
];
// every instrument's name as the page lists it also works in a description
for (const i of Object.values(INST)) {
  const w = i.name.toLowerCase();
  if (!INSTRUMENT_WORDS.some(([x]) => x === w)) INSTRUMENT_WORDS.push([w, i.id]);
}
const BASS_ONLY = new Set(["contrabass", "acoustic_bass", "electric_bass_finger", "electric_bass_pick", "synth_bass_1", "tuba", "timpani"]);
const LEADS = new Set(["flute", "oboe", "clarinet", "alto_sax", "tenor_sax", "harmonica", "trumpet", "violin", "lead_2_sawtooth", "music_box", "overdriven_guitar", "french_horn", "glockenspiel", "steel_drums", "xylophone", "celesta"]);
const VOICE_WORDS = ["vocals", "vocal", "singing", "singer", "sing", "voice", "voices", "choir", "lyrics", "rapper"];
const NEGATE = new Set(["no", "not", "without", "never", "don't", "dont"]);

// Finds each phrase from a list in the token stream; returns [{phrase, at}] in order of position.
function findPhrases(toks, phrases) {
  const text = " " + toks.join(" ") + " ", hits = [];
  // longer phrases first, so "bass guitar" is not also read as "guitar"
  for (const ph of [...phrases].sort((a, b) => b.split(" ").length - a.split(" ").length)) {
    const len = ph.split(" ").length;
    let from = 0;
    for (;;) {
      const i = text.indexOf(" " + ph + " ", from);
      if (i < 0) break;
      const at = text.slice(0, i + 1).trim().split(" ").filter(Boolean).length;
      if (!hits.some(h => at < h.at + h.len && h.at < at + len)) hits.push({ phrase: ph, at, len });
      from = i + 1;
    }
  }
  return hits.sort((a, b) => a.at - b.at);
}
const negated = (toks, at) => NEGATE.has(toks[at - 1]) || NEGATE.has(toks[at - 2]);

function said(toks, table) {
  for (const hit of findPhrases(toks, Object.values(table).flat())) {
    if (negated(toks, hit.at)) continue;
    const value = Object.keys(table).find(k => table[k].includes(hit.phrase));
    return { value, words: [hit.phrase], how: "said" };
  }
  return null;
}

const KEY_NAMES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/* ---------- Putting it together ---------- */
export function readDescription(text) {
  const toks = tokensOf(text);
  const out = { notes: [] };

  // style
  const styleSaid = said(toks, STYLE_WORDS);
  const styleModel = modelAnswer("style", toks);
  out.style = styleSaid || { value: styleModel.value, words: styleModel.words, how: styleModel.clues ? "model" : "default", conf: styleModel.conf, probs: styleModel.probs };
  const style = out.style.value, S = STYLES[style];

  // mood (bright means a major key, sad or dark a minor key)
  const moodSaid = said(toks, MOOD_WORDS);
  const moodModel = modelAnswer("mood", toks);
  out.mood = moodSaid || { value: moodModel.value, words: moodModel.words, how: moodModel.clues ? "model" : "default", conf: moodModel.conf };
  if (!moodSaid && S.minor) out.mood = { value: "dark", words: [S.name.toLowerCase()], how: "style" };
  out.minor = out.mood.value !== "bright";

  // key and mode named outright
  const keyMatch = text.toLowerCase().match(/\b([a-g])\s*(#|b|sharp|flat)?\s+(major|minor)\b/);
  if (keyMatch) {
    let k = KEY_NAMES[keyMatch[1]];
    if (keyMatch[2] === "#" || keyMatch[2] === "sharp") k++;
    if (keyMatch[2] === "b" || keyMatch[2] === "flat") k--;
    out.key = (k + 12) % 12;
    out.minor = keyMatch[3] === "minor";
    out.mood = { ...out.mood, how: "said", words: [keyMatch[0].trim()], value: out.minor ? (out.mood.value === "bright" ? "sad" : out.mood.value) : "bright" };
  } else if (/\bminor\b/.test(toks.join(" ")) || /\bmajor key\b/.test(toks.join(" "))) {
    out.minor = toks.includes("minor");
    out.mood = { value: out.minor ? (out.mood.value === "bright" ? "sad" : out.mood.value) : "bright", words: [out.minor ? "minor" : "major"], how: "said" };
  }

  // speed
  const speedSaid = said(toks, SPEED_WORDS);
  const speedModel = modelAnswer("speed", toks);
  out.speed = speedSaid || { value: speedModel.value, words: speedModel.words, how: speedModel.clues ? "model" : "default", conf: speedModel.conf };
  out.tempo = S.tempo[["slow", "medium", "fast"].indexOf(out.speed.value)];
  const bpm = text.toLowerCase().match(/\b(\d{2,3})\s*(bpm|beats per minute)\b/);
  if (bpm) { out.tempo = Math.max(40, Math.min(180, +bpm[1])); out.speed = { value: out.speed.value, words: [bpm[0]], how: "said" }; }

  // length
  // length: bars, a time ("a one minute song", "30 seconds"), or short and long
  const nearest = (n, opts) => opts.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
  const low = text.toLowerCase();
  const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, half: 0.5 };
  const barsMatch = low.match(/\b(\d{1,2})\s*(bars?|measures?)\b/);
  const timeMatch = low.match(/\b(\d+(?:\.\d+)?|an?|one|two|three|half an?|half)\s*(?:-\s*)?(minutes?|mins?|seconds?|secs?)\b/);
  out.bars = 16; out.lengthHow = "default";
  if (barsMatch) { out.bars = nearest(+barsMatch[1], [4, 8, 12, 16, 24, 32]); out.lengthHow = "said"; }
  else if (timeMatch) {
    const n = WORDS[timeMatch[1].split(" ")[0]] ?? parseFloat(timeMatch[1]);
    const seconds = n * (timeMatch[2].startsWith("m") ? 60 : 1);
    out.bars = nearest((seconds * out.tempo) / 240, [8, 16, 24, 32]); out.lengthHow = "said";
  } else if (toks.some(t => ["short", "brief", "tiny", "quick"].includes(t))) { out.bars = 8; out.lengthHow = "said"; }
  else if (toks.some(t => ["full", "extended"].includes(t)) || /\bvery long\b/.test(low)) { out.bars = 32; out.lengthHow = "said"; }
  else if (toks.some(t => ["long", "longer"].includes(t))) { out.bars = 24; out.lengthHow = "said"; }

  // creativity
  out.creativity = 0.9;
  if (toks.some(t => ["experimental", "weird", "wild", "unpredictable", "crazy", "strange", "chaotic", "random", "bold", "creative", "unusual"].includes(t))) out.creativity = 1.2;
  else if (toks.some(t => ["simple", "classic", "traditional", "predictable", "safe", "basic", "plain"].includes(t))) out.creativity = 0.7;

  // the band
  const band = S.band.slice();
  const named = [];
  for (const hit of findPhrases(toks, INSTRUMENT_WORDS.map(([w]) => w))) {
    if (negated(toks, hit.at)) continue;
    const entry = INSTRUMENT_WORDS.find(([w]) => w === hit.phrase)[1];
    const id = typeof entry === "function" ? entry(style) : entry;
    if (!named.includes(id)) named.push(id);
  }
  const bass = named.filter(id => BASS_ONLY.has(id)), others = named.filter(id => !BASS_ONLY.has(id));
  // "only a piano", "just piano", "piano solo", "harp by itself": play the named instruments and nobody else
  const hits = findPhrases(toks, INSTRUMENT_WORDS.map(([w]) => w)).filter(h => !negated(toks, h.at));
  const near = hits.some(h => [1, 2, 3].some(d => ["only", "just"].includes(toks[h.at - d])) || ["only", "alone"].includes(toks[h.at + h.len]));
  const only = named.length > 0 && (near || toks.some(t => ["solo", "alone", "unaccompanied"].includes(t))
    || /\b(by itself|on its own|nothing but|nothing else|and nothing more)\b/.test(toks.join(" ")));
  if (only) {
    const lead = others.find(id => LEADS.has(id)) || others[0] || bass[0];
    const rest = others.filter(id => id !== lead), chordal = named.find(id => CHORDAL.has(id));
    band[0] = lead; band[1] = rest[0] || "off"; band[2] = rest[1] || "off"; band[3] = bass.find(id => id !== lead) || "off";
    // a piano, guitar or harp plays its own chords and bass line
    if (chordal) { if (band[2] === "off") band[2] = chordal; if (band[3] === "off") band[3] = chordal; }
  } else {
    if (bass.length) band[3] = bass[0];
    if (others.length) {
      const lead = others.find(id => LEADS.has(id)) || others[0];
      const rest = others.filter(id => id !== lead);
      band[0] = lead;
      if (rest.length) { band[1] = rest[0]; band[2] = rest[1] || rest[0]; }
    }
  }
  out.band = band;
  out.named = named;
  out.only = only;

  // drums
  const drumHits = findPhrases(toks, ["drums", "drum", "beat", "beats", "percussion", "drummer"]);
  const noDrums = drumHits.some(h => negated(toks, h.at));
  out.drums = noDrums ? null : drumHits.length ? (S.drums || (style === "spooky" ? "cinematic" : "folk")) : only ? null : S.drums;
  // a slow movie score keeps its big drums out unless they were asked for
  if (!drumHits.length && style === "cinematic" && out.speed.value === "slow") out.drums = null;
  out.drumsHow = noDrums || drumHits.length ? "said" : "style";

  if (findPhrases(toks, VOICE_WORDS).length) out.notes.push("This composer has no singers, so the song is all instruments.");
  out.tokens = toks;
  return out;
}

export function instName(id) { return INST[id] ? INST[id].name : "Off"; }

// The model's answers alone, without the words read as-is (used to check the page against Python).
export const modelGuess = text => Object.fromEntries(["style", "mood", "speed"].map(h => [h, modelAnswer(h, tokensOf(text)).value]));
