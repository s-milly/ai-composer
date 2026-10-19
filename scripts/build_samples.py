"""Build site/samples from the most realistic free recordings of each instrument.

No single free library sounds best for every instrument, so each one comes from the library that
recorded it best: real guitars and basses from Karoryfer Samples, the Salamander Grand Piano, a
Wurlitzer electric piano by Greg Sullivan, orchestral instruments from VSCO 2 and VCSL (Versilian
Studios), saxophones from MTG, and guitars from the University of Iowa and Freesound via
tonejs-instruments. Instruments no free library records well (synths, accordion, music box, celesta,
steel drums, timpani, brass section) keep the Musyng Kite soundfont, as does any note outside the
range a library recorded.

For every third semitone from G1 the script takes the nearest recorded note, trims the silence
before it starts, checks its pitch, shifts it to the exact note, levels the instrument to the
loudness the band was balanced at, and saves 3.5 seconds as mono 96 kbps mp3.

  python scripts/build_samples.py [instrument ...]

Source repositories are cloned (without their audio until needed) into data/raw/sample-sources.
"""
import base64, os, re, subprocess, sys, time, urllib.request
import numpy as np
from scipy import signal
sys.path.insert(0, os.path.dirname(__file__))
from sfzread import regions, pick

SR = 44100
NOTES = list(range(31, 91, 3))
SRC = "data/raw/sample-sources"
NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
REPOS = {
    "vsco2": "https://github.com/sgossner/VSCO-2-CE",
    "vcsl": "https://github.com/sgossner/VCSL",
    "tonejs": "https://github.com/nbrosowsky/tonejs-instruments",
    "salamander": "https://github.com/sfzinstruments/SalamanderGrandPiano",
    "epianos": "https://github.com/sfzinstruments/GregSullivan.E-Pianos",
    "green": "https://github.com/sfzinstruments/karoryfer.black-and-green-guitars",
    "emily": "https://github.com/sfzinstruments/karoryfer.emilyguitar",
    "basses": "https://github.com/sfzinstruments/karoryfer.black-and-blue-basses",
    "cello": "https://github.com/sfzinstruments/karoryfer-bigcat.cello",
    "ganjo": "https://github.com/sfzinstruments/ganjo",
    "sax": "https://github.com/sfzinstruments/MTG.SoloSax",
}
# Where each instrument comes from. sfz: a mapping file in the repo (prefer narrows to sample
# names containing that text); folder: samples named by note, filtered by text they must or must
# not contain; split: different sources by range (low note of each); amp: run through a guitar amp.
# Most VSCO 2 and VCSL sets name middle C "C3", so they sound an octave above their names; the
# solo violin and the harp are named the usual way. Checked with three pitch estimates and each
# instrument's real range.
VSCO = lambda folder, inc=(), exc=(), octave=12: {"repo": "vsco2", "folder": folder, "inc": inc, "exc": exc, "octave": octave}
VCSL = lambda folder, inc=(), exc=(), octave=12: {"repo": "vcsl", "folder": folder, "inc": inc, "exc": exc, "octave": octave}
SOURCES = {
    "acoustic_grand_piano": {"repo": "salamander", "sfz": "Salamander Grand Piano V3.sfz", "vel": 85},
    "electric_piano_1": {"repo": "epianos", "sfz": "Wurlitzer EP200/Wurlitzer EP200.sfz", "vel": 90},
    "harpsichord": VCSL("Chordophones/Zithers/Harpsichord, English", ["_Normal_"], ["_Rel_"]),
    "church_organ": VCSL("Aerophones/Edge-blown Aerophones/Pipe Organ", ["Man3Open"]),
    "glockenspiel": VCSL("Idiophones/Struck Idiophones/Glockenspiel", ["_medium_"]),
    "vibraphone": VCSL("Idiophones/Struck Idiophones/Vibraphone", ["Vibes_hard", "_v2_"]),
    "marimba": VCSL("Idiophones/Struck Idiophones/Marimba", ["_med_"]),
    "xylophone": VCSL("Idiophones/Struck Idiophones/Xylophone", ["Xylo_Hard", "_ff_"]),
    "acoustic_guitar_nylon": {"repo": "tonejs", "folder": "samples/guitar-nylon", "inc": [".wav"]},
    "acoustic_guitar_steel": {"repo": "tonejs", "folder": "samples/guitar-acoustic", "inc": [".wav"]},
    "electric_guitar_clean": {"repo": "green", "sfz": "Programs/04-green_twang.sfz", "vel": 90},
    "overdriven_guitar": {"repo": "emily", "sfz": "emily_clean.sfz", "vel": 100, "amp": True},
    "banjo": {"repo": "ganjo", "sfz": "ganjo.sfz", "vel": 90},
    "orchestral_harp": VCSL("Chordophones/Composite Chordophones/Concert Harp", ["_mf1"], octave=0),   # named the usual way
    "violin": VSCO("Strings/Solo Violin/Arco Vib", ["_f."], octave=0),   # this set is named the usual way
    "viola": VSCO("Strings/Viola Section/susvib", ["_v2"]),
    "cello": {"repo": "cello", "sfz": "Programs/vc_arco_eight_map.sfz", "vel": 90},
    "contrabass": VSCO("Strings/Solo Contrabass/SusVib", ["_v3_"]),
    "string_ensemble_1": {"split": [(0, VSCO("Strings/Cello Section/susvib", ["_v2"])), (50, VSCO("Strings/Viola Section/susvib", ["_v2"])),
                                    (57, VSCO("Strings/Violin Section/susVib", ["_v2"]))]},
    "tremolo_strings": {"split": [(0, VSCO("Strings/Cello Section/trem", ["_v2"])), (50, VSCO("Strings/Viola Section/trem", ["_v2"])),
                                  (57, VSCO("Strings/Violin Section/Trem", ["_v2"]))]},
    "pizzicato_strings": {"split": [(0, VSCO("Strings/Cello Section/pizzT", ["_v2_RR1"])), (50, VSCO("Strings/Viola Section/pizz", ["_v2_rr1"])),
                                    (57, VSCO("Strings/Violin Section/Pizz", ["_v2_rr1"]))]},
    "flute": VSCO("Woodwinds/Flute/susvib"),
    "oboe": VSCO("Woodwinds/Oboe/Vib"),
    "clarinet": VSCO("Woodwinds/Clarinet/susLong"),
    "bassoon": VSCO("Woodwinds/Bassoon/vib"),
    "alto_sax": {"repo": "sax", "sfz": "MTG Solo Saxophones/MTG Alto Sax.sfz", "vel": 110, "prefer": "alt_f_", "only": True},
    "tenor_sax": {"repo": "sax", "sfz": "MTG Solo Saxophones/MTG Tenor Sax.sfz", "vel": 110, "prefer": "ten_f_", "only": True},
    "harmonica": VCSL("Aerophones/Free Aerophones/Harmonica-Hohner-Special20-C", ["_Normal_"], ["_rel_"]),
    "trumpet": VSCO("Brass/Trumpet/sus"),
    "french_horn": VSCO("Brass/F Horn/sus"),
    "trombone": VSCO("Brass/Tenor Trombone/sus"),
    "tuba": VSCO("Brass/Tuba/sus"),
    "acoustic_bass": VSCO("Strings/Solo Contrabass/Pizz", ["_rr1"]),
    "electric_bass_finger": {"repo": "basses", "sfz": "Programs/05-darkblack_pluck.sfz", "vel": 90},
    "electric_bass_pick": {"repo": "basses", "sfz": "Programs/03-babyblue_all.sfz", "vel": 90},
}
FALLBACK = "MusyngKite"
BELLS = {"glockenspiel", "vibraphone", "marimba", "xylophone", "church_organ"}
MAX_REACH = 4   # semitones a recording may be shifted beyond the range the library recorded
TARGET_DB = {"acoustic_grand_piano": -36.5, "electric_piano_1": -28.4, "harpsichord": -32.2, 
             "church_organ": -26.8, "marimba": -33.9, "vibraphone": -35.3, "acoustic_guitar_nylon": -33.5, 
             "orchestral_harp": -34.7, "violin": -26.9, "viola": -29.3, "cello": -30.2, "contrabass": -36.2, 
             "string_ensemble_1": -30.6, "pizzicato_strings": -33.1, "flute": -27.7, "oboe": -27.2, 
             "clarinet": -25.7, "bassoon": -28.4, "trumpet": -30.8, "french_horn": -26.9, "trombone": -23.8, 
             "tuba": -21.6, "acoustic_bass": -32.6, "alto_sax": -25.6, "electric_guitar_clean": -33.2, 
             "overdriven_guitar": -26.3, "acoustic_guitar_steel": -33.0, "banjo": -38.5, 
             "electric_bass_finger": -29.4, "electric_bass_pick": -30.1, "synth_bass_1": -34.2, 
             "lead_2_sawtooth": -28.7, "pad_2_warm": -30.1, "music_box": -34.6, "celesta": -33.4, 
             "xylophone": -43.8, "glockenspiel": -34.2, "steel_drums": -34.8, "harmonica": -30.5, 
             "accordion": -31.1, "brass_section": -28.1, "timpani": -44.9, "tremolo_strings": -30.3, 
             "tenor_sax": -26.9}


def git(repo, *args, text=False):
    return subprocess.run(["git", "-C", os.path.join(SRC, repo), *args], capture_output=True, check=True, text=text).stdout


def clone(repo):
    path = os.path.join(SRC, repo)
    if not os.path.exists(path):
        os.makedirs(SRC, exist_ok=True)
        subprocess.run(["git", "clone", "-q", "--depth", "1", "--filter=blob:none", "--no-checkout", REPOS[repo], path], check=True)
    if not os.path.exists(os.path.join(path, ".maps")):
        # mapping files only; audio is fetched one file at a time when needed
        files = git(repo, "ls-tree", "-r", "--name-only", "HEAD", text=True).split("\n")
        keep = ["/" + f.replace(" ", "?") for f in files if f and not re.search(r"\.(wav|flac|ogg|mp3|png|jpg|psd|eps|pdf)$", f, re.I)]
        git(repo, "sparse-checkout", "set", "--no-cone", *keep)
        git(repo, "checkout", "-q")
        open(os.path.join(path, ".maps"), "w").close()
    return path


def audio(repo, rel):
    """One sample file as mono float audio at 44.1 kHz."""
    files = audio.files.setdefault(repo, git(repo, "ls-tree", "-r", "--name-only", "HEAD", text=True).split("\n"))
    if rel not in files:   # some mappings point at the samples folder from another file's folder
        rel = next(f for f in files if os.path.basename(f) == os.path.basename(rel))
    data = git(repo, "show", f"HEAD:{rel}")
    out = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", "-", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], input=data, capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.float32).copy()
audio.files = {}


def recorded(spec):
    """{midi note: (repo, file)} for the notes a source recorded."""
    repo = spec["repo"]; clone(repo)
    if "sfz" in spec:
        regs = regions(os.path.join(SRC, repo, spec["sfz"]))
        pref = [r for r in regs if spec.get("prefer", "\0") in r["sample"]]
        if pref and spec.get("only"):
            regs = pref
        out = {}
        for m in range(21, 109):
            got = (pick(pref, m, spec["vel"]) if pref else None) or pick(regs, m, spec["vel"])
            if got:
                f, kc = got
                out.setdefault(kc, (repo, os.path.relpath(f, os.path.join(SRC, repo))))
        return out
    out = {}
    # when several files name the same note, take the louder layer (higher v number)
    for f in sorted(git(repo, "ls-tree", "-r", "--name-only", "HEAD", spec["folder"], text=True).split("\n"), reverse=True):
        name = os.path.basename(f)
        if not f or not re.search(r"\.(wav|flac|mp3)$", name) or any(x not in name for x in spec.get("inc", ())) or any(x in name for x in spec.get("exc", ())):
            continue
        m = re.search(r"(?:^|[_ -])([A-G][#b]?)(-?\d)(?=[_ .-]|[a-z]*\.)", name)
        if not m:
            continue
        nm, octave = m.group(1), int(m.group(2))
        pc = SHARP.index(nm) if nm in SHARP else NAMES.index(nm)
        out.setdefault(12 * (octave + 1) + pc, (repo, f))
    return out


def detect_pitch(x):
    """Rough fundamental of a note (MIDI number), from autocorrelation of its steady part."""
    seg = x[int(0.08 * SR): int(0.6 * SR)]
    if len(seg) < 2048 or np.abs(seg).max() < 1e-4:
        return None
    seg = seg - seg.mean()
    ac = signal.fftconvolve(seg, seg[::-1])[len(seg) - 1:]
    lo, hi = int(SR / 2200), int(SR / 25)
    lag = lo + int(np.argmax(ac[lo:hi]))
    # prefer the shortest lag that is nearly as strong (avoids octave-low answers)
    for k in range(2, 6):
        l2 = int(round(lag / k))
        if l2 >= lo and ac[l2] > 0.85 * ac[lag]:
            lag = l2
    return 69 + 12 * np.log2(SR / lag / 440)


def spectral_pitch(x):
    """Fundamental from a harmonic product spectrum: a second opinion that fails in different ways."""
    seg = x[int(0.08 * SR): int(0.6 * SR)]
    if len(seg) < 4096 or np.abs(seg).max() < 1e-4:
        return None
    n = 1 << 16
    mag = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n))
    hps = mag.copy()
    for h in (2, 3, 4):
        d = mag[::h]; hps[: len(d)] *= d
    f = np.fft.rfftfreq(n, 1 / SR)
    band = (f > 25) & (f < 2200)
    return 69 + 12 * np.log2(f[band][np.argmax(hps[band])] / 440)


def octave_offset(rec, process):
    """How far a library's note names are from the pitches it recorded, in whole octaves.
    Both pitch methods must agree on most of a spread of its recordings."""
    keys = sorted(rec)
    probe = [keys[int(i)] for i in np.linspace(0, len(keys) - 1, min(8, len(keys)))]
    votes = []
    for k in probe:
        x = process(trim_start(audio(*rec[k])))
        a, b = detect_pitch(x), spectral_pitch(x)
        if a is not None and b is not None and round((a - k) / 12) == round((b - k) / 12):
            votes.append(round((a - k) / 12) * 12)
    if not votes:
        return 0
    common = max(set(votes), key=votes.count)
    return common if votes.count(common) >= 0.7 * len(probe) else 0


def peak_pitch(x):
    seg = x[int(0.05 * SR): int(0.5 * SR)]
    if len(seg) < 4096 or np.abs(seg).max() < 1e-4:
        return None
    n = 1 << 16
    mag = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n)); f = np.fft.rfftfreq(n, 1 / SR)
    band = (f > 25) & (f < 5000)
    return 69 + 12 * np.log2(f[band][np.argmax(mag[band])] / 440)


def mistuning(x, k):
    """How far a recording sits from the note it is filed under (ignoring octaves), when three
    different pitch estimates agree on it; otherwise 0. Catches mislabelled files."""
    ests = [e for e in (detect_pitch(x), spectral_pitch(x), peak_pitch(x)) if e is not None]
    if len(ests) < 3:
        return 0.0
    errs = [((e - k + 6) % 12) - 6 for e in ests]
    if max(errs) - min(errs) > 0.35 or abs(np.mean(errs)) < 0.45:
        return 0.0
    return float(np.mean(errs))


def trim_start(x):
    """Drop the silence a recording has before the note begins."""
    level = np.abs(x).max()
    if level == 0:
        return x
    i = int(np.argmax(np.abs(x) > level * 0.02))
    return x[max(0, i - int(0.004 * SR)):]


def shifted(x, semis):
    if abs(semis) < 1e-3:
        return x
    r = 2 ** (semis / 12)
    up, down = int(round(1000 / r)), 1000
    g = np.gcd(up, down)
    return signal.resample_poly(x, up // g, down // g).astype(np.float32)


def amp(x):
    """A clean guitar recorded direct, played through a driven amp and a speaker cabinet."""
    b, a = signal.butter(2, 120 / (SR / 2), "high"); x = signal.lfilter(b, a, x)
    x = np.tanh(x / (np.abs(x).max() + 1e-9) * 18)
    b, a = signal.butter(4, 4200 / (SR / 2), "low"); y = signal.lfilter(b, a, x)
    b, a = signal.iirpeak(1600 / (SR / 2), 1.2); y = y + 0.4 * signal.lfilter(b, a, x)
    return (y / (np.abs(y).max() + 1e-9) * 0.5).astype(np.float32)


def fallback(inst, m):
    path = os.path.join(SRC, "musyngkite", f"{inst}_{m}.mp3")
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        for attempt in range(6):
            try:
                js = urllib.request.urlopen(f"https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/{FALLBACK}/{inst}-mp3.js", timeout=120).read().decode()
                break
            except OSError:
                time.sleep(20 * (attempt + 1))
        for nm, b64 in re.findall(r'"([A-G]b?-?\d)":\s*"data:audio/mp3;base64,([^"]+)"', js):
            k = 12 * (int(nm[-1]) + 1) + NAMES.index(nm[:-1])
            open(os.path.join(SRC, "musyngkite", f"{inst}_{k}.mp3"), "wb").write(base64.b64decode(b64))
    out = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.float32).copy()


def build(inst):
    spec = SOURCES.get(inst)
    parts = spec["split"] if spec and "split" in spec else [(0, spec)] if spec else []
    process = amp if (spec or {}).get("amp") else (lambda x: x)
    # each library's recordings keyed by the pitch they really are
    maps = []
    for lo, sp in parts:
        rec = recorded(sp)
        off = sp.get("octave")
        if off is None:
            off = octave_offset(rec, process) if rec else 0
        maps.append((lo, {k + off: (src, off) for k, src in rec.items()}))
    notes, report, real = {}, [], set()
    for m in NOTES:
        x = None
        for lo, rec in sorted(maps, reverse=True):
            if m >= lo or lo == min(l for l, _ in maps):
                if rec:
                    k = min(rec, key=lambda n: abs(n - m))
                    if abs(k - m) <= 1 or min(rec) - MAX_REACH <= m <= max(rec) + MAX_REACH:
                        (src, off) = rec[k]
                        raw = process(trim_start(audio(*src)))
                        err = mistuning(raw, k)
                        x = shifted(raw, m - k - err)
                        report.append(f"{m}:{k}" + (f"({off:+d})" if off else "") + (f"[tuned {err:+.1f}]" if err else ""))
                        real.add(m)
                break
        if x is None:
            x = fallback(inst, m); report.append(f"{m}:mk")
            # some soundfont notes were recorded in the wrong octave; fix those all three estimates agree on
            ests = [e for e in (detect_pitch(x), spectral_pitch(x), peak_pitch(x)) if e is not None]
            # (not for synths, which layer octaves on purpose, or bells and bars, whose overtones fool the estimates)
            if spec and inst not in BELLS and len(ests) == 3 and max(ests) - min(ests) < 0.35 and abs(np.mean(ests) - m) > 11.5:
                k = round((np.mean(ests) - m) / 12) * 12
                x = shifted(x, -k); report[-1] += f"({-k:+d})"
        notes[m] = x
    level = lambda y: np.sqrt((y[: int(1.5 * SR)] ** 2).mean())
    for m in NOTES:
        if m in real:
            continue
        if level(notes[m]) < 1e-4:   # the soundfont has nothing here: shift the nearest note that sounds
            k = min((n for n in NOTES if level(notes[n]) >= 1e-4), key=lambda n: abs(n - m))
            notes[m] = shifted(notes[k], m - k)
        if real:   # a soundfont note beside real recordings plays at their loudness
            k = min(real, key=lambda n: abs(n - m))
            notes[m] = notes[m] * (level(notes[k]) / max(level(notes[m]), 1e-6))
    # level the instrument to where the band was balanced
    rms = np.median([np.sqrt((notes[m][: int(1.5 * SR)] ** 2).mean()) for m in NOTES if 43 <= m <= 79])
    gain = 10 ** ((TARGET_DB[inst] - 20 * np.log10(rms + 1e-9)) / 20)
    peak = max(np.abs(x).max() for x in notes.values()) * gain
    gain *= min(1.0, 0.95 / peak)
    os.makedirs(f"site/samples/{inst}", exist_ok=True)
    for m, x in notes.items():
        x = x[: int(3.5 * SR)] * gain
        fade = min(int(0.35 * SR), len(x)); x[-fade:] *= np.linspace(1, 0, fade)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", "-b:a", "96k",
                        f"site/samples/{inst}/{m}.mp3"], input=x.astype(np.float32).tobytes(), check=True)
    print(inst, " ".join(report), flush=True)


if __name__ == "__main__":
    exec(re.search(r"INSTRUMENTS = \[.*?\]", open(os.path.join(os.path.dirname(__file__), "fetch_samples.py")).read(), re.S).group(0))
    for inst in sys.argv[1:] or INSTRUMENTS:
        build(inst)
