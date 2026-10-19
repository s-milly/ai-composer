"""Download instrument recordings (the Musyng Kite General MIDI soundfont, CC BY-SA 3.0, rendered by
gleitz/midi-js-soundfonts) every third semitone. The page shifts the nearest one by at most one
semitone to play any note. No vocal instruments are included.

  python scripts/fetch_samples.py [CACHE_DIR]

Each instrument comes as one file holding all its notes (fewer requests than one per note). A few
instruments have silent notes at the edge of their range; those are filled from the nearest real
note, pitch-shifted the way the page would. GAIN_DB evens out how loud each instrument was recorded,
matched to the levels the band was first balanced with."""
import base64, os, re, subprocess, sys, time, urllib.request

FONT = "MusyngKite"
BASE = f"https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/{FONT}"
NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
INSTRUMENTS = ["acoustic_grand_piano", "electric_piano_1", "harpsichord", "church_organ", "marimba", "vibraphone",
               "acoustic_guitar_nylon", "orchestral_harp", "violin", "viola", "cello", "contrabass",
               "string_ensemble_1", "pizzicato_strings", "flute", "oboe", "clarinet", "bassoon",
               "trumpet", "french_horn", "trombone", "tuba", "acoustic_bass", "alto_sax",
               "electric_guitar_clean", "overdriven_guitar", "acoustic_guitar_steel", "banjo", "electric_bass_finger",
               "electric_bass_pick", "synth_bass_1", "lead_2_sawtooth", "pad_2_warm", "music_box", "celesta",
               "xylophone", "glockenspiel", "steel_drums", "harmonica", "accordion", "brass_section", "timpani",
               "tremolo_strings", "tenor_sax"]
NOTES = list(range(31, 91, 3))  # G1 to Gb6 covers every voice after transposing to any key
GAIN_DB = {"acoustic_grand_piano": 3.1, "electric_piano_1": -0.0, "harpsichord": 3.2, "church_organ": -0.4, 
           "marimba": 1.7, "vibraphone": 2.7, "acoustic_guitar_nylon": 3.2, "orchestral_harp": 2.6, 
           "violin": 10.5, "viola": 5.5, "cello": 1.1, "contrabass": -3.8, "string_ensemble_1": -4.7, 
           "pizzicato_strings": 9.2, "flute": 3.6, "oboe": 7.6, "clarinet": 3.1, "bassoon": 4.5, 
           "trumpet": 2.8, "french_horn": 6.3, "trombone": 9.2, "tuba": 1.7, "acoustic_bass": 2.2, 
           "alto_sax": 4.7, "electric_guitar_clean": 4.7, "overdriven_guitar": 3.5, 
           "acoustic_guitar_steel": 1.9, "banjo": 0.3, "electric_bass_finger": -5.8, "electric_bass_pick": 6.4, 
           "synth_bass_1": 0.9, "lead_2_sawtooth": 2.8, "pad_2_warm": -5.6, "music_box": 3.7, "celesta": 1.2, 
           "xylophone": -5.4, "glockenspiel": 4.7, "steel_drums": 3.1, "harmonica": 2.0, "accordion": 6.0, 
           "brass_section": 4.3, "timpani": -9.3, "tremolo_strings": 0.2, "tenor_sax": 2.8}
CACHE = sys.argv[1] if len(sys.argv) > 1 else "data/raw/musyngkite"


def fetch(inst):
    """The soundfont mp3 for every note we keep, saved as CACHE/inst_midi.mp3."""
    os.makedirs(CACHE, exist_ok=True)
    if all(os.path.exists(f"{CACHE}/{inst}_{m}.mp3") for m in NOTES):
        return
    for attempt in range(6):
        try:
            js = urllib.request.urlopen(f"{BASE}/{inst}-mp3.js", timeout=120).read().decode()
            break
        except OSError:
            time.sleep(20 * (attempt + 1))
    notes = dict(re.findall(r'"([A-G]b?-?\d)":\s*"data:audio/mp3;base64,([^"]+)"', js))
    for m in NOTES:
        open(f"{CACHE}/{inst}_{m}.mp3", "wb").write(base64.b64decode(notes[f"{NAMES[m % 12]}{m // 12 - 1}"]))


def peak(path):
    out = subprocess.run(["ffmpeg", "-i", path, "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True).stderr
    m = re.search(r"max_volume: (-?[\d.]+) dB", out)
    return float(m.group(1)) if m else -99.0


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True).stdout
    return float(out.strip())


for inst in INSTRUMENTS:
    fetch(inst)
    os.makedirs(f"site/samples/{inst}", exist_ok=True)
    real = [m for m in NOTES if peak(f"{CACHE}/{inst}_{m}.mp3") > -40]
    for m in NOTES:
        near = min(real, key=lambda r: abs(r - m))
        rate = 2 ** ((m - near) / 12)
        # a shifted note plays faster, so it is shorter; fade out over the last 0.35 s either way
        length = min(3.5, duration(f"{CACHE}/{inst}_{near}.mp3") / rate)
        shift = f"asetrate=44100*{rate:.6f},aresample=44100," if near != m else ""
        # mono 96 kbps keeps plucked attacks clean
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", f"{CACHE}/{inst}_{near}.mp3",
                        "-af", f"{shift}volume={GAIN_DB[inst]}dB,afade=t=out:st={length - 0.35:.3f}:d=0.35", "-t", f"{length:.3f}",
                        "-ac", "1", "-ar", "44100", "-b:a", "96k",
                        f"site/samples/{inst}/{m}.mp3"], check=True)
    print(inst, "filled" if len(real) < len(NOTES) else "", [m for m in NOTES if m not in real], flush=True)
