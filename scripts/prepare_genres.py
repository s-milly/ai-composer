"""Build the multi-genre training set: melodies with chords from
  pop        POP909 (909 Chinese pop songs) and the CoCoPops Billboard subset (214 US hits, 1958-1991)
  rock       CoCoPops Rolling Stone subset (de Clercq and Temperley's RS200)
  folk       the Nottingham Music Database (cleaned by Jukedeck), tunes in duple time
  classical  music21 corpus: Bach chorales and string quartets by Haydn, Mozart and Beethoven
  jazz       Weimar Jazz Database solos, when data/raw/wjazzd/wjazzd.db is present
  classical  DCML corpora: sonatas, quartets, trio sonatas, suites and songs with expert chord labels
  mixed      lead sheets from OpenEWLD (public domain songs, genres from Discogs) and the Chord Melody
             Dataset (jazz standards and pop hits; genres in scripts/cmd_genres.txt)
Only music in 4/4, 2/4 or 2/2 is kept. Writes data/songs.pkl.
"""
import glob, os, pickle, re, sqlite3, sys, warnings
import numpy as np
NO_CHORD_ROOT = 12
from songdata import harte, finalize, estimate_chord, pc_of, fix_mode, QUALITIES

warnings.filterwarnings("ignore")
RAW = "data/raw"


def log(*a):
    print(*a, flush=True)


# ---------- POP909 ----------
def pop909():
    import pretty_midi
    out = []
    for d in sorted(glob.glob(f"{RAW}/pop909/[0-9][0-9][0-9]")):
        sid = os.path.basename(d)
        try:
            beats = np.loadtxt(f"{d}/beat_midi.txt")
            keys = [l.split() for l in open(f"{d}/key_audio.txt") if l.strip()]
            chords = [l.split() for l in open(f"{d}/chord_midi.txt") if l.strip()]
            midi = pretty_midi.PrettyMIDI(f"{d}/{sid}.mid")
        except Exception:
            continue
        down = np.nonzero(beats[:, 2] == 1)[0]
        if len(down) < 8 or np.median(np.diff(down)) != 4:
            continue  # not 4/4
        if len({k[2] for k in keys}) > 1:
            continue  # keep songs that stay in one key
        tonic, mode = keys[0][2].split(":")
        times = beats[down[0]:, 0]
        # seconds -> beats by interpolating between beat times, then to sixteenths
        def six(t):
            b = np.interp(t, times, np.arange(len(times)), left=-1, right=len(times) + (t - times[-1]) / max(1e-3, np.median(np.diff(times))))
            return int(round(b * 4))
        mel = next((i for i in midi.instruments if i.name.upper() == "MELODY"), None)
        if mel is None:
            continue
        notes = [(six(n.start), max(1, six(n.end) - six(n.start)), n.pitch) for n in mel.notes]
        chs = [(six(float(s)), six(float(e)), harte(c)) for s, e, c in chords]
        steps = (len(times) * 4) // 16 * 16
        song = finalize([n for n in notes if n[0] >= 0], chs, pc_of(tonic), mode.startswith("min"), steps, "pop", f"pop909/{sid}")
        if song:
            out.append(song)
    return out


# ---------- CoCoPops ----------
KERN = re.compile(r"^(\d+)?(\.*)([A-Ga-gr]+)([#\-n]*)")


def kern_pitch(tok):
    m = re.search(r"([A-Ga-g]+)([#\-]*)", tok)
    if not m:
        return None
    letters, acc = m.groups()
    octave = 4 + (len(letters) - 1) if letters[0].islower() else 3 - (len(letters) - 1)
    pc = pc_of(letters[0].upper())
    return 12 * (octave + 1) + pc + acc.count("#") - acc.count("-")


def kern_dur(tok):
    m = re.match(r"^(\d+)(\.*)", tok.strip("[(_){}"))
    if not m:
        return None
    n = int(m.group(1))
    d = 16 / n if n else 32
    d *= (1.5 if len(m.group(2)) == 1 else 1.75 if len(m.group(2)) == 2 else 1)
    return d


def humdrum_rows(path):
    lines = [l.rstrip("\n").split("\t") for l in open(path, encoding="utf8", errors="ignore") if not l.startswith("!!")]
    head = next(i for i, l in enumerate(lines) if l[0].startswith("**"))
    return lines[head][:], lines[head + 1:]


def key_of(tok):
    m = re.match(r"^\*([A-Ga-g][#\-]?):", tok)
    return (pc_of(m.group(1).upper()), m.group(1)[0].islower()) if m else None


def cocopops_tb(path, genre):
    """Rolling Stone files: each data row lasts 1/N of a whole note, set by *tbN."""
    spines, rows = humdrum_rows(path)
    if "**kern" not in spines or "**harte" not in spines:
        return None
    ki, hi = spines.index("**kern"), spines.index("**harte")
    t, tb, key, notes, chords, meter_ok = 0.0, 4, None, [], [], True
    cur = None
    for r in rows:
        if len(r) <= max(ki, hi):
            continue
        a = r[0]
        if a.startswith("="):
            continue
        if a.startswith("*"):
            for tok in r:
                if tok.startswith("*tb"):
                    tb = int(re.sub(r"\D", "", tok) or 4)
                if tok.startswith("*M") and tok[2:] not in ("4/4", "2/4", "2/2"):
                    meter_ok = False
                k = key_of(tok)
                if k and key is None:
                    key = k
            continue
        if a.startswith("!"):
            continue
        on = int(round(t))
        m, h = r[ki], r[hi]
        if h not in (".", ""):
            if chords:
                chords[-1][1] = on
            chords.append([on, None, harte(h)])
        if m not in (".", ""):
            if cur:
                cur[1] = on - cur[0]
                cur = None
            if "r" not in m and "_" not in m:
                p = kern_pitch(m)
                if p:
                    cur = [on, 1, p]
                    notes.append(cur)
        t += 16 / tb
    if not meter_ok or key is None:
        return None
    steps = int(t) // 16 * 16
    if cur:
        cur[1] = steps - cur[0]
    if chords:
        chords[-1][1] = steps
    return finalize([tuple(n) for n in notes], [tuple(c) for c in chords], key[0], key[1], steps, genre, path.split("raw/")[1])


def cocopops_dur(path, genre):
    """Billboard files: standard **kern durations; rows advance to the next event in any timed spine."""
    spines, rows = humdrum_rows(path)
    if "**kern" not in spines or "**harte" not in spines or "**harm" not in spines:
        return None
    ki, hi, ri = spines.index("**kern"), spines.index("**harte"), spines.index("**harm")
    t, key, notes, chords, meter_ok = 0.0, None, [], [], True
    nxt = {ki: 0.0, ri: 0.0}
    tie = None
    for r in rows:
        if len(r) <= max(ki, hi, ri):
            continue
        a = r[0]
        if a.startswith("=") or a.startswith("!"):
            continue
        if a.startswith("*"):
            for tok in r:
                if tok.startswith("*M") and re.match(r"^\*M\d+/\d+$", tok) and tok[2:] not in ("4/4", "2/4", "2/2"):
                    meter_ok = False
                k = key_of(tok)
                if k and key is None:
                    key = k
            continue
        t = min(v for v in nxt.values()) if nxt else t
        on = int(round(t * 1))
        for col in (ki, ri):
            tok = r[col].split(" ")[0]
            if tok in (".", ""):
                continue
            d = kern_dur(tok.lstrip("(["))
            if d is None:
                continue
            nxt[col] = t + d
            if col == ki and "r" not in tok:
                p = kern_pitch(tok)
                if p is None:
                    continue
                if tok.endswith("]") or tok.endswith("_") and tie:
                    if tie:
                        tie[1] = int(round(t + d)) - tie[0]
                    if tok.endswith("]"):
                        tie = None
                    continue
                n = [on, max(1, int(round(d))), p]
                notes.append(n)
                tie = n if tok.startswith("[") else None
        h = r[hi]
        if h not in (".", ""):
            if chords:
                chords[-1][1] = on
            chords.append([on, None, harte(h)])
    if not meter_ok or key is None:
        return None
    steps = int(max(nxt.values())) // 16 * 16
    if chords:
        chords[-1][1] = steps
    return finalize([tuple(n) for n in notes], [tuple(c) for c in chords], key[0], key[1], steps, genre, path.split("raw/")[1])


def cocopops():
    out = []
    for p in sorted(glob.glob(f"{RAW}/cocopops/RollingStone/*.hum")):
        try:
            s = cocopops_tb(p, "rock")
        except Exception as e:
            s = None
        if s:
            out.append(s)
    n_rock = len(out)
    for p in sorted(glob.glob(f"{RAW}/cocopops/Billboard/*.hum")):
        try:
            s = cocopops_dur(p, "pop")
        except Exception:
            s = None
        if s:
            out.append(s)
    log("cocopops rock", n_rock, "billboard pop", len(out) - n_rock)
    return out


# ---------- Nottingham (folk) ----------
def nottingham():
    from music21 import converter, harmony, meter, key as m21key
    out = []
    for f in sorted(glob.glob(f"{RAW}/nottingham/*.abc")):
        text = open(f, encoding="latin-1").read()
        for tune in re.split(r"\n(?=X:)", text):
            mm = re.search(r"^M:\s*(\S+)", tune, re.M)
            if not mm or mm.group(1) not in ("4/4", "2/4", "2/2", "C", "C|"):
                continue
            try:
                s = converter.parse(tune, format="abc")
            except Exception:
                continue
            flat = s.flatten()
            k = flat.getElementsByClass(m21key.KeySignature).first()
            try:
                an = s.analyze("key")
            except Exception:
                continue
            notes, chords = [], []
            for n in flat.notes:
                if isinstance(n, harmony.ChordSymbol):
                    root = n.root().pitchClass if n.root() else None
                    fig = n.figure
                    q = "min" if re.match(r"^[A-G][#b-]?m(?!a)", fig) else "dim" if "dim" in n.chordKind or fig.endswith("d") else "7" if "7" in fig else "maj"
                    chords.append([int(round(n.offset * 4)), None, (root, QUALITIES.index(q)) if root is not None else None])
                elif n.isNote:
                    notes.append((int(round(n.offset * 4)), max(1, int(round(n.quarterLength * 4))), n.pitch.midi))
            if len(chords) < 4:
                continue
            steps = int(round(flat.highestTime * 4)) // 16 * 16
            for i in range(len(chords)):
                chords[i][1] = chords[i + 1][0] if i + 1 < len(chords) else steps
            song = finalize(notes, [tuple(c) for c in chords], an.tonic.pitchClass, an.mode == "minor", steps, "folk", f"nottingham/{os.path.basename(f)}")
            if song:
                out.append(song)
    return out


# ---------- Lead sheets (OpenEWLD and the Chord Melody Dataset) ----------
def m21_quality(kind):
    """music21 chord kind ('minor-seventh', 'dominant-ninth', ...) -> one of QUALITIES."""
    k = kind or "major"
    if "half-diminished" in k:
        return "hdim7"
    if "diminished" in k:
        return "dim"
    if "augmented" in k:
        return "aug"
    if "suspended" in k:
        return "sus"
    if k.startswith("major-minor") or k.startswith("minor-major"):
        return "min"
    if k.startswith("minor"):
        return "min7" if any(x in k for x in ("seventh", "ninth", "11th", "13th")) else "min"
    if k.startswith("dominant"):
        return "7"
    if k.startswith("major") and any(x in k for x in ("seventh", "ninth", "11th", "13th")):
        return "maj7"
    return "maj"


def leadsheet(path, genre, source, tonic=None):
    """A one-staff lead sheet with chord symbols, in 4/4, 2/4 or 2/2."""
    from music21 import converter, harmony
    s = converter.parse(path)
    part = s.parts[0].stripTies()
    sigs = {t.ratioString for t in s.recurse().getElementsByClass("TimeSignature")}
    if not sigs or not sigs <= {"4/4", "2/4", "2/2"}:
        return None
    first = part.getElementsByClass("Measure").first()
    bar = first.barDuration.quarterLength if first is not None else 4
    pad = (bar - first.duration.quarterLength) if first is not None and first.duration.quarterLength < bar else 0
    notes, chords = [], []
    for n in part.flatten().notes:
        on = int(round((n.offset + pad) * 4))
        if isinstance(n, harmony.ChordSymbol):
            if n.root() is None:
                continue
            ch = (n.root().pitchClass, QUALITIES.index(m21_quality(n.chordKind)))
            if not chords or chords[-1][2] != ch:
                chords.append([on, None, ch])
        elif n.isChord:
            notes.append((on, max(1, int(round(n.quarterLength * 4))), max(p.midi for p in n.pitches)))
        else:
            notes.append((on, max(1, int(round(n.quarterLength * 4))), n.pitch.midi))
    if len(chords) < 4:
        return None
    steps = int(round((part.highestTime + pad) * 4)) // 16 * 16
    for i in range(len(chords)):
        chords[i][1] = chords[i + 1][0] if i + 1 < len(chords) else steps
    if tonic is None:
        # the key signature read as a major key; fix_mode moves songs whose home chord is minor
        ks = s.recurse().getElementsByClass("KeySignature").first()
        tonic = ks.asKey("major").tonic.pitchClass if ks is not None else s.analyze("key").tonic.pitchClass
    song = finalize(notes, [tuple(c) for c in chords], tonic, False, steps, genre, source)
    return relative_minor(song)


def relative_minor(song):
    """A key signature cannot tell C major from A minor. Call the song minor when A minor chords
    outnumber C major ones and it ends on A minor (it is already in place for a minor song)."""
    if song is None:
        return None
    r, q = song["root"], song["qual"]
    minors = [QUALITIES.index("min"), QUALITIES.index("min7")]
    home_min = ((r == 9) & np.isin(q, minors)).sum()
    home_maj = ((r == 0) & ~np.isin(q, minors)).sum()
    last = r[r != NO_CHORD_ROOT][-1:] if (r != NO_CHORD_ROOT).any() else []
    if home_min > home_maj and len(last) and last[0] == 9:
        return {**song, "mode": 1}
    return song


EWLD_GENRE = {"Jazz": "jazz", "Rock": "rock", "Pop": "pop", "Stage & Screen": "pop", "Funk / Soul": "pop", "Latin": "pop",
              "Electronic": "pop", "Reggae": "pop", "Blues": "jazz", "Folk, World, & Country": "folk", "Classical": "classical",
              "Brass & Military": "folk"}
# Discogs tags the recordings, not the song: an old standard gets "Rock" because a rock band covered it.
# Only call a song rock when its styles say rock too.
ROCK_STYLES = {"Rock & Roll", "Pop Rock", "Blues Rock", "Rockabilly", "Punk", "Country Rock", "Hard Rock", "Classic Rock",
               "Folk Rock", "Soft Rock", "Psychedelic Rock", "Garage Rock", "Alternative Rock", "Indie Rock"}


def openewld():
    base = f"{RAW}/openewld"
    con = sqlite3.connect(f"{base}/OpenEWLD.db")
    out = []
    for wid, path in con.execute("select id, path_leadsheet from works"):
        gs = con.execute("select genre from work_genres where id=? order by occurrences desc", (wid,)).fetchall()
        styles = {r[0] for r in con.execute("select style from work_style where id=?", (wid,))}
        if not gs or gs[0][0] not in EWLD_GENRE:
            continue
        g = EWLD_GENRE[gs[0][0]]
        if g == "rock" and not styles & ROCK_STYLES:
            g = "pop"
        if g == "pop" and styles & {"Swing", "Big Band", "Dixieland", "Ragtime", "Bop", "Hard Bop", "Cool Jazz"}:
            g = "jazz"
        try:
            s = leadsheet(f"{base}/{path}", g, "openewld/" + os.path.basename(path))
        except Exception:
            s = None
        if s:
            out.append(s)
    return out


def chord_melody():
    """The Chord Melody Dataset stores every song in all 12 keys; c.xml is the copy moved to C."""
    labels = {}
    for line in open(os.path.join(os.path.dirname(__file__), "cmd_genres.txt")):
        if line.strip() and not line.startswith("#"):
            g, *names = line.split()
            labels.update({n: g for n in names})
    out = []
    for d in sorted(glob.glob(f"{RAW}/cmd/*/")):
        name = os.path.basename(d.rstrip("/"))
        if not os.path.exists(f"{d}c.xml"):
            continue
        try:
            s = leadsheet(f"{d}c.xml", labels.get(name, "jazz"), f"cmd/{name}", tonic=0)
        except Exception:
            s = None
        if s:
            out.append(s)
    return out


# ---------- Classical ----------
def classical():
    from music21 import corpus, chord as m21chord
    out = []
    # Bach chorales: already on a sixteenth grid in data/chorales.pkl (soprano = melody)
    for c in pickle.load(open("data/chorales.pkl", "rb")):
        g = c["grid"]
        steps = len(g) // 16 * 16
        sound = np.zeros((len(g), 4), dtype=int); cur = [0, 0, 0, 0]
        for t in range(len(g)):
            for v in range(4):
                tok = g[t, v]
                cur[v] = 0 if tok == 1 else cur[v] if tok == 0 else tok - 2 + 33
            sound[t] = cur
        notes = []
        for t in range(len(g)):
            if g[t, 0] >= 2:
                l = 1
                while t + l < len(g) and g[t + l, 0] == 0:
                    l += 1
                notes.append((t, l, int(g[t, 0]) - 2 + 33))
        chords = [(b * 4, b * 4 + 4, estimate_chord([p for p in sound[b * 4] if p])) for b in range(steps // 4)]
        tonic = 9 if c["mode"] else 0
        song = finalize(notes, chords, tonic, bool(c["mode"]), steps, "classical", "bach/" + c["name"])
        if song:
            out.append(song)
    n_bach = len(out)
    # string quartets: first violin is the melody, chords from all four parts beat by beat
    for comp in ["haydn", "mozart", "beethoven"]:
        for path in corpus.getComposer(comp):
            try:
                s = corpus.parse(path)
            except Exception:
                continue
            if len(s.parts) != 4:
                continue
            ts = s.recurse().getElementsByClass("TimeSignature").first()
            if ts is None or ts.ratioString not in ("4/4", "2/4", "2/2"):
                continue
            try:
                k = s.analyze("key")
            except Exception:
                continue
            notes = []
            for n in s.parts[0].flatten().notes:
                p = max(n.pitches).midi if n.isChord else n.pitch.midi
                notes.append((int(round(n.offset * 4)), max(1, int(round(n.quarterLength * 4))), p))
            steps = int(s.highestTime * 4) // 16 * 16
            sounding = [[] for _ in range(steps // 4)]
            for part in s.parts:
                for n in part.flatten().notes:
                    for b in range(int(n.offset), min(steps // 4, int(np.ceil(n.offset + n.quarterLength)))):
                        sounding[b] += [p.midi for p in n.pitches]
            chords = [(b * 4, b * 4 + 4, estimate_chord(sounding[b])) for b in range(steps // 4)]
            song = finalize(notes, chords, k.tonic.pitchClass, k.mode == "minor", steps, "classical", f"{comp}/{os.path.basename(str(path))}")
            if song:
                out.append(song)
    log("classical bach", n_bach, "quartets", len(out) - n_bach)
    return out


# ---------- Classical with expert chord labels (DCML corpora) ----------
DCML_TYPE = {"M": "maj", "m": "min", "o": "dim", "+": "aug", "Mm7": "7", "mm7": "min7", "MM7": "maj7", "mM7": "min",
             "%7": "hdim7", "o7": "dim", "+7": "aug", "+M7": "aug", "Ger": "7", "It": "7", "Fr": "7"}
SCALES = {False: [0, 2, 4, 5, 7, 9, 11], True: [0, 2, 3, 5, 7, 8, 10]}
ROMAN = {"i": 0, "ii": 1, "iii": 2, "iv": 3, "v": 4, "vi": 5, "vii": 6}


def roman_key(numeral, minor):
    """'vi/V' in a major (minor=False) key -> (semitones above the tonic, is the new key minor)."""
    off = 0
    for part in reversed(numeral.split("/")):
        m = re.match(r"^([#b]*)([ivIV]+)$", part)
        if not m:
            return None
        acc, deg = m.groups()
        off += SCALES[minor][ROMAN[deg.lower()]] + acc.count("#") - acc.count("b")
        minor = deg.islower()
    return off % 12, minor


def frac(x):
    from fractions import Fraction
    return float(Fraction(x)) if x not in ("", None) else None


def dcml_piece(base, piece, corpus):
    import csv
    read = lambda kind: list(csv.DictReader(open(f"{base}/{kind}/{piece}.{kind}.tsv", encoding="utf8"), delimiter="\t"))
    measures = read("measures")
    if not measures or any(m["timesig"] not in ("4/4", "2/4", "2/2") for m in measures):
        return None
    num, den = map(int, measures[0]["timesig"].split("/"))
    bar = num * 4 / den
    first = frac(measures[0]["duration_qb"])
    pad = bar - first if first < bar else 0      # pickup bar: shift so downbeats land on beat one
    notes = []
    for r in read("notes"):
        on = frac(r["quarterbeats"])
        if on is None or r["staff"] != "1" or r.get("gracenote"):
            continue
        on6, dur6, p = int(round((on + pad) * 4)), int(round(frac(r["duration_qb"]) * 4)), int(r["midi"])
        if r.get("tied") in ("0", "-1"):     # continues a tied note
            for n in reversed(notes[-4:]):
                if n[2] == p:
                    n[1] = on6 + dur6 - n[0]
                    break
            continue
        if notes and notes[-1][0] == on6:
            if p > notes[-1][2]:
                notes[-1] = [on6, max(1, dur6), p]
            continue
        notes.append([on6, max(1, dur6), p])
    chords, gkey = [], None
    for r in read("harmonies"):
        on = frac(r["quarterbeats"])
        if on is None or not r["globalkey"] or r["chord_type"] not in DCML_TYPE or r["root"] in ("", None):
            continue
        g = r["globalkey"]
        if gkey is None:
            gkey = (pc_of(g[0].upper() + g[1:].replace("#", "#").replace("b", "b")), g[0].islower())
        lk = roman_key(r["localkey"], gkey[1])
        if lk is None:
            continue
        root = (gkey[0] + lk[0] + int(float(r["root"])) * 7) % 12
        ch = (root, QUALITIES.index(DCML_TYPE[r["chord_type"]]))
        on6 = int(round((on + pad) * 4))
        if chords and chords[-1][0] == on6:
            chords[-1][2] = ch
        elif not chords or chords[-1][2] != ch:
            chords.append([on6, None, ch])
    if gkey is None or len(chords) < 4 or not notes:
        return None
    steps = max(n[0] + n[1] for n in notes) // 16 * 16
    for i in range(len(chords)):
        chords[i][1] = chords[i + 1][0] if i + 1 < len(chords) else steps
    return finalize([tuple(n) for n in notes], [tuple(c) for c in chords], gkey[0], gkey[1], steps, "classical", f"dcml/{corpus}/{piece}")


def dcml():
    out = []
    for base in sorted(glob.glob(f"{RAW}/dcml/*")):
        corpus = os.path.basename(base)
        for f in sorted(glob.glob(f"{base}/harmonies/*.harmonies.tsv")):
            piece = os.path.basename(f)[:-len(".harmonies.tsv")]
            try:
                s = dcml_piece(base, piece, corpus)
            except (OSError, ValueError, KeyError):
                s = None
            if s:
                out.append(s)
    return out


# ---------- Jazz (Weimar Jazz Database) ----------
def wjazzd():
    db = f"{RAW}/wjazzd/wjazzd.db"
    if not os.path.exists(db):
        log("jazz: data/raw/wjazzd/wjazzd.db not found, skipping")
        return []
    con = sqlite3.connect(db)
    out = []
    sols = con.execute("select melid, key, signature from solo_info").fetchall()
    for melid, key, sig in sols:
        if sig not in ("4/4", "2/2") or not key:
            continue
        k = key.split("-")
        try:
            tonic = pc_of(k[0]); minor = len(k) > 1 and k[1].startswith("min")
        except KeyError:
            continue
        beats = con.execute("select onset, bar, beat, chord from beats where melid=? order by onset", (melid,)).fetchall()
        if len(beats) < 32:
            continue
        times = np.array([b[0] for b in beats])
        def six(t):
            return int(round(np.interp(t, times, np.arange(len(times))) * 4))
        notes = [(six(o), max(1, six(o + d) - six(o)), int(round(p))) for o, d, p in con.execute("select onset, duration, pitch from melody where melid=? order by onset", (melid,))]
        chords, last = [], None
        for i, (_, _, _, ch) in enumerate(beats):
            if ch and ch != last:
                if chords:
                    chords[-1][1] = i * 4
                chords.append([i * 4, None, jazz_chord(ch)]); last = ch
        steps = len(beats) * 4 // 16 * 16
        if chords:
            chords[-1][1] = steps
        song = finalize(notes, [tuple(c) for c in chords], tonic, minor, steps, "jazz", f"wjazzd/{melid}")
        if song:
            out.append(song)
    return out


def jazz_chord(sym):
    m = re.match(r"^([A-G][b#]?)(.*)$", sym.strip())
    if not m:
        return None
    root, q = m.groups()
    q = q.split("/")[0]
    if q.startswith("m7b5") or "ø" in q:
        qq = "hdim7"
    elif q.startswith("o") or "dim" in q:
        qq = "dim"
    elif q.startswith("j7") or q.startswith("maj7") or q.startswith("j"):
        qq = "maj7"
    elif q.startswith("-7") or q.startswith("m7") or q.startswith("-9") or q.startswith("-11"):
        qq = "min7"
    elif q.startswith("-") or q.startswith("m"):
        qq = "min"
    elif q.startswith("sus"):
        qq = "sus"
    elif q.startswith("+"):
        qq = "aug"
    elif q[:1] in ("7", "9") or q.startswith("13") or q.startswith("11"):
        qq = "7"
    else:
        qq = "maj"
    return pc_of(root), QUALITIES.index(qq)


if __name__ == "__main__":
    which = sys.argv[1:] or ["pop909", "cocopops", "nottingham", "classical", "dcml", "wjazzd", "openewld", "chord_melody"]
    songs = []
    for name in which:
        got = [fix_mode(s) for s in globals()[name]()]
        log(name, len(got), "songs")
        songs += got
    from collections import Counter
    log(Counter(s["genre"] for s in songs), "total", len(songs))
    log({g: sum(len(s["melody"]) for s in songs if s["genre"] == g) // 16 for g in set(s["genre"] for s in songs)}, "bars")
    pickle.dump(songs, open("data/songs.pkl", "wb"))
