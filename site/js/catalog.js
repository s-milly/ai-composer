// Instruments, parts and band styles shared by the composer, the player and the Song Maker.

// [id, name, GM program, stage icon, rings out on its own]
const RAW = [
  ["acoustic_grand_piano", "Piano", 0, "piano", 1], ["electric_piano_1", "Electric piano", 4, "keys", 1],
  ["harpsichord", "Harpsichord", 6, "piano", 1], ["celesta", "Celesta", 8, "keys", 1],
  ["church_organ", "Organ", 19, "organ", 0], ["accordion", "Accordion", 21, "accordion", 0],
  ["music_box", "Music box", 10, "musicbox", 1], ["glockenspiel", "Glockenspiel", 9, "mallets", 1],
  ["vibraphone", "Vibraphone", 11, "mallets", 1], ["marimba", "Marimba", 12, "mallets", 1],
  ["xylophone", "Xylophone", 13, "mallets", 1], ["steel_drums", "Steel drums", 114, "steelpan", 1],
  ["acoustic_guitar_nylon", "Classical guitar", 24, "guitar", 1], ["acoustic_guitar_steel", "Acoustic guitar", 25, "guitar", 1],
  ["electric_guitar_clean", "Electric guitar", 27, "eguitar", 1], ["overdriven_guitar", "Rock guitar", 29, "eguitar", 0],
  ["banjo", "Banjo", 105, "banjo", 1], ["orchestral_harp", "Harp", 46, "harp", 1],
  ["violin", "Violin", 40, "violin", 0], ["viola", "Viola", 41, "violin", 0],
  ["cello", "Cello", 42, "cello", 0], ["contrabass", "Double bass", 43, "cello", 0],
  ["string_ensemble_1", "String section", 48, "strings", 0], ["tremolo_strings", "Tremolo strings", 44, "strings", 0],
  ["pizzicato_strings", "Plucked strings", 45, "strings", 1],
  ["flute", "Flute", 73, "flute", 0], ["oboe", "Oboe", 68, "clarinet", 0], ["clarinet", "Clarinet", 71, "clarinet", 0],
  ["bassoon", "Bassoon", 70, "bassoon", 0], ["alto_sax", "Alto sax", 65, "sax", 0], ["tenor_sax", "Tenor sax", 66, "sax", 0],
  ["harmonica", "Harmonica", 22, "harmonica", 0],
  ["trumpet", "Trumpet", 56, "trumpet", 0], ["brass_section", "Brass section", 61, "trumpet", 0],
  ["french_horn", "French horn", 60, "horn", 0], ["trombone", "Trombone", 57, "trombone", 0], ["tuba", "Tuba", 58, "tuba", 0],
  ["timpani", "Timpani", 47, "timpani", 1],
  ["acoustic_bass", "Upright bass", 32, "cello", 1], ["electric_bass_finger", "Bass guitar", 33, "ebass", 1],
  ["electric_bass_pick", "Picked bass", 34, "ebass", 1], ["synth_bass_1", "Synth bass", 38, "synth", 1],
  ["lead_2_sawtooth", "Synth lead", 81, "synth", 0], ["pad_2_warm", "Synth pad", 89, "synth", 0],
];
export const INSTRUMENTS = RAW.map(([id, name, prog, icon, decays]) => ({ id, name, prog, icon, decays: !!decays }));
export const INST = Object.fromEntries(INSTRUMENTS.map(i => [i.id, i]));
export const DRUMS_ID = "drums";

export const PARTS = [
  { name: "Melody", color: "var(--p0)" },
  { name: "High harmony", color: "var(--p1)" },
  { name: "Low harmony", color: "var(--p2)" },
  { name: "Bass", color: "var(--p3)" },
];
export const DRUM_PART = { name: "Drums", color: "var(--p4)" };

// Each style says which genre the chords and melody are written in (the models were trained on
// pop, rock, jazz, classical and folk music), how busy the melody is compared with the speed
// (-1 sparser, +1 busier), the usual band, how each part plays the chords (see arrange.js),
// the drum beat and a speed range: tempo is [slow, medium, fast] in beats per minute.
export const STYLES = {
  classical: { name: "Classical", genre: "classical", dens: 0, band: ["violin", "violin", "viola", "cello"],
    play: ["melody", "upper", "lower", "root"], drums: null, tempo: [66, 84, 104], swing: 0 },
  ballad: { name: "Ballad", genre: "pop", dens: -1, band: ["acoustic_grand_piano", "string_ensemble_1", "acoustic_grand_piano", "cello"],
    play: ["melody", "pad", "arp", "root"], drums: null, tempo: [60, 72, 84], swing: 0 },
  pop: { name: "Pop and dance", genre: "pop", dens: 0, band: ["lead_2_sawtooth", "electric_piano_1", "pad_2_warm", "synth_bass_1"],
    play: ["melody", "stab", "pad", "root8"], drums: "pop", tempo: [96, 112, 126], swing: 0 },
  rock: { name: "Rock", genre: "rock", dens: 0, band: ["overdriven_guitar", "electric_guitar_clean", "overdriven_guitar", "electric_bass_pick"],
    play: ["melody", "strum", "power8", "root8"], drums: "rock", tempo: [96, 120, 144], swing: 0 },
  jazz: { name: "Jazz", genre: "jazz", dens: 1, band: ["alto_sax", "vibraphone", "electric_piano_1", "acoustic_bass"],
    play: ["melody", "comp", "comp2", "walk"], drums: "jazz", tempo: [76, 112, 152], swing: 0.66 },
  folk: { name: "Folk and country", genre: "folk", dens: 0, band: ["violin", "acoustic_guitar_steel", "banjo", "acoustic_bass"],
    play: ["melody", "strum", "pick", "rootfifth"], drums: "folk", tempo: [80, 100, 120], swing: 0 },
  march: { name: "March", genre: "folk", dens: 0, band: ["trumpet", "french_horn", "trombone", "tuba"],
    play: ["melody", "upper", "pah", "oom"], drums: "march", tempo: [96, 112, 124], swing: 0 },
  cinematic: { name: "Movie score", genre: "classical", dens: -1, band: ["french_horn", "string_ensemble_1", "orchestral_harp", "contrabass"],
    play: ["melody", "pad", "arp", "root8"], drums: "cinematic", tempo: [66, 88, 112], swing: 0 },
  lullaby: { name: "Lullaby", genre: "pop", dens: -1, band: ["music_box", "string_ensemble_1", "orchestral_harp", "cello"],
    play: ["melody", "pad", "arp", "root"], drums: null, tempo: [50, 60, 72], swing: 0 },
  spooky: { name: "Spooky", genre: "classical", dens: -1, band: ["celesta", "church_organ", "pizzicato_strings", "contrabass"],
    play: ["melody", "pad", "arp", "root"], drums: null, tempo: [56, 72, 92], swing: 0, minor: true },
};
export const STYLE_ORDER = ["classical", "ballad", "pop", "rock", "jazz", "folk", "march", "cinematic", "lullaby", "spooky"];

export const KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const noteName = m => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
export const scaleOf = (key, minor) => new Set((minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]).map(i => (key + i) % 12));

export const DRUM_ROWS = [
  ["crash", "Crash"], ["ride", "Ride"], ["open", "Open hat"], ["hat", "Closed hat"],
  ["clap", "Clap"], ["snare", "Snare"], ["tom", "Tom"], ["kick", "Kick"],
];

// One bar of each drum beat, in sixteenth notes: [drum, steps, volume].
export const BEATS = {
  rock: [["kick", [0, 8, 10], 1], ["snare", [4, 12], 0.9], ["hat", [0, 2, 4, 6, 8, 10, 12, 14], 0.5]],
  pop: [["kick", [0, 4, 8, 12], 1], ["clap", [4, 12], 0.8], ["open", [2, 6, 10, 14], 0.45], ["hat", [1, 3, 5, 7, 9, 11, 13, 15], 0.22]],
  jazz: [["ride", [0, 4, 6, 8, 12, 14], 0.5], ["hat", [4, 12], 0.4], ["kick", [0], 0.3]],
  folk: [["kick", [0, 8], 0.8], ["snare", [4, 12], 0.45], ["hat", [0, 2, 4, 6, 8, 10, 12, 14], 0.3]],
  march: [["kick", [0, 8], 0.8], ["snare", [0, 2, 4, 6, 7, 8, 10, 12, 14, 15], 0.6], ["crash", [0], 0.25]],
  cinematic: [["tom", [0, 3, 6, 8, 12], 0.9], ["kick", [0, 8], 0.7], ["snare", [12], 0.4]],
};
export const BEAT_NAMES = { rock: "Rock", pop: "Pop and dance", jazz: "Jazz swing", folk: "Folk", march: "March", cinematic: "Movie score" };
