"""A common format for songs from every source: a melody on a sixteenth-note grid and one chord
per beat, both moved to C major or A minor.

Melody tokens: HOLD (0), REST (1), or a pitch (MIDI pitch - LOW + 2).
Chords: root pitch class (0-11, or 12 for no chord) and a quality index into QUALITIES.
"""
import re
import numpy as np

GENRES = ["pop", "rock", "jazz", "classical", "folk"]
QUALITIES = ["maj", "min", "7", "maj7", "min7", "dim", "hdim7", "sus", "aug"]
HOLD, REST = 0, 1
LOW, HIGH = 52, 88          # melody range kept, E3 to E6
N_PITCH = HIGH - LOW + 1
NO_CHORD = 12

NOTE_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def pc_of(name):
    """'Bb' or 'F#' or 'E-' -> pitch class."""
    pc = NOTE_PC[name[0].upper()]
    for ch in name[1:]:
        pc += {"#": 1, "b": -1, "-": -1}.get(ch, 0)
    return pc % 12


def quality_of(q):
    """Harte-style quality text -> one of QUALITIES."""
    q = q.split("/")[0].replace("(", "").replace(")", "").lower()
    if q in ("", "maj", "maj6", "6", "add9", "maj(9)", "5", "1", "majadd9", "69", "maj69"):
        return "maj"
    if q.startswith("hdim") or q in ("m7b5", "min7b5"):
        return "hdim7"
    if q.startswith("dim"):
        return "dim"
    if q.startswith("aug") or q == "+":
        return "aug"
    if q.startswith("sus"):
        return "sus"
    if q.startswith("maj7") or q.startswith("maj9") or q.startswith("maj11") or q.startswith("maj13"):
        return "maj7"
    if q.startswith("minmaj"):
        return "min"
    if q.startswith("min7") or q.startswith("min9") or q.startswith("min11") or q.startswith("min13"):
        return "min7"
    if q.startswith("min") or q == "m" or q.startswith("m6"):
        return "min"
    if q[:1] in ("7", "9") or q.startswith("11") or q.startswith("13"):
        return "7"
    if q.startswith("maj"):
        return "maj"
    return "maj"


def harte(label):
    """'A:min7', 'Bb:maj/3', 'N' -> (root pc, quality index) or None."""
    label = label.strip()
    if not label or label in ("N", "X", "*", "."):
        return None
    root, _, q = label.partition(":")
    try:
        return pc_of(root), QUALITIES.index(quality_of(q or "maj"))
    except (KeyError, IndexError):
        return None


TEMPLATES = {"maj": (0, 4, 7), "min": (0, 3, 7), "7": (0, 4, 7, 10), "maj7": (0, 4, 7, 11), "min7": (0, 3, 7, 10),
             "dim": (0, 3, 6), "hdim7": (0, 3, 6, 10), "sus": (0, 5, 7), "aug": (0, 4, 8)}


def estimate_chord(pitches):
    """Best chord for a set of sounding MIDI pitches (used where a source has no chord labels)."""
    if not pitches:
        return None
    w = np.zeros(12)
    for p in pitches:
        w[p % 12] += 1
    bass = min(pitches) % 12
    best, score = None, -1e9
    for qi, q in enumerate(QUALITIES):
        tones = TEMPLATES[q]
        for r in range(12):
            pcs = {(r + t) % 12 for t in tones}
            s = sum(w[p] for p in pcs) - 1.2 * sum(w[p] for p in range(12) if p not in pcs) - 0.3 * len(tones)
            s += 0.6 * (bass == r) + (0.2 if q in ("maj", "min") else 0)
            if s > score:
                best, score = (r, qi), s
    return best


def finalize(notes, chords, tonic, minor, steps, genre, source):
    """notes: [(onset, length, midi pitch)] in sixteenths; chords: [(onset, end, (root, quality) or None)].
    Moves the song to C major / A minor, centers the melody's octave and builds the grids."""
    if steps < 64 or len(notes) < 16:
        return None
    shift = (-(tonic - (9 if minor else 0))) % 12
    if shift > 6:
        shift -= 12
    pitches = np.array([p + shift for _, _, p in notes])
    octave = int(round((70 - np.median(pitches)) / 12)) * 12
    mel = np.full(steps, REST, dtype=np.int16)
    order = sorted(notes, key=lambda n: n[0])
    for i, (s, l, p) in enumerate(order):
        if s >= steps or s < 0:
            continue
        p = p + shift + octave
        while p < LOW:
            p += 12
        while p > HIGH:
            p -= 12
        end = min(steps, s + max(1, l))
        if i + 1 < len(order):
            nxt = order[i + 1][0]
            # sung and played notes often stop just short of the next one; close gaps under an eighth note
            if 0 <= nxt - end <= 2:
                end = nxt
            end = min(end, max(s + 1, nxt))
        mel[s] = p - LOW + 2
        mel[s + 1:end] = HOLD
    beats = steps // 4
    root = np.full(beats, NO_CHORD, dtype=np.int8)
    qual = np.zeros(beats, dtype=np.int8)
    for s, e, ch in chords:
        if ch is None:
            continue
        r, q = ch
        for b in range(max(0, s // 4), min(beats, (e + 3) // 4)):
            if b * 4 >= s - 2:   # a chord owns the beats it starts on or covers
                root[b] = (r + shift) % 12
                qual[b] = q
    if (root == NO_CHORD).mean() > 0.6:
        return None
    return {"genre": genre, "mode": int(minor), "melody": mel, "root": root, "qual": qual, "source": source}


def fix_mode(song):
    """Some sources give only the tonic. If the home chord is mostly minor, call the song minor
    and move it from C to A like every other minor song."""
    if song is None or song["mode"] == 1:
        return song
    home = song["root"] == 0
    if home.sum() < 4:
        return song
    minor_home = np.isin(song["qual"][home], [QUALITIES.index("min"), QUALITIES.index("min7")]).mean()
    if minor_home <= 0.5:
        return song
    mel = song["melody"].copy()
    notes = mel >= 2
    p = mel[notes] - 3
    p[p < 2] += 12
    mel[notes] = p
    root = np.where(song["root"] == NO_CHORD, NO_CHORD, (song["root"] - 3) % 12).astype(np.int8)
    return {**song, "mode": 1, "melody": mel, "root": root}
