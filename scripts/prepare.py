"""Turn the Bach chorales in the music21 corpus into training sequences.

Each chorale becomes a grid of sixteenth notes with four voices (soprano, alto, tenor, bass).
Every cell is a token: a MIDI pitch where a note starts, HOLD where the previous note keeps
sounding, or REST. Chorales are transposed to C major or A minor so the model learns one key
per mode; the page transposes the result into whatever key the user picks.
"""
import json, pickle, sys
import numpy as np
from music21 import corpus, interval, pitch

HOLD, REST = 0, 1          # token ids; pitches are stored as MIDI number - LOW + 2
LOW, HIGH = 33, 84         # MIDI range kept after transposition (A1 to C6)
STEPS_PER_BAR = 16


def to_grid(part, n_steps, shift):
    grid = np.full(n_steps, REST, dtype=np.int16)
    for n in part.flatten().notesAndRests:
        start = int(round((n.offset + shift) * 4))
        length = int(round(n.quarterLength * 4))
        if length <= 0 or start >= n_steps:
            continue
        if n.isRest:
            grid[start:start + length] = REST
            continue
        if n.isChord:
            n = n.notes[-1]
        midi = n.pitch.midi
        if n.tie is not None and n.tie.type in ("continue", "stop"):
            grid[start:start + length] = HOLD
            continue
        if not LOW <= midi <= HIGH:
            return None
        grid[start] = midi - LOW + 2
        grid[start + 1:start + length] = HOLD
    return grid


def main():
    out = []
    skipped = {"parts": 0, "meter": 0, "range": 0}
    for name in corpus.chorales.Iterator(returnType="filename"):
        s = corpus.parse(name)
        if len(s.parts) != 4:
            skipped["parts"] += 1
            continue
        ts = s.recurse().getElementsByClass("TimeSignature").first()
        if ts is None or ts.ratioString != "4/4":
            skipped["meter"] += 1
            continue
        k = s.analyze("key")
        target = pitch.Pitch("C" if k.mode == "major" else "A")
        semis = (target.pitchClass - k.tonic.pitchClass) % 12
        if semis > 6:
            semis -= 12
        s = s.transpose(interval.Interval(semis))
        # A pickup bar is shorter than four beats; pad the front so beat one lands on step 0 of a bar.
        m1 = s.parts[0].getElementsByClass("Measure").first()
        shift = (4 - m1.duration.quarterLength) % 4 if m1.duration.quarterLength < 4 else 0
        total = s.parts[0].flatten().highestTime + shift
        n_steps = int(np.ceil(total * 4 / STEPS_PER_BAR)) * STEPS_PER_BAR
        grids = [to_grid(p, n_steps, shift) for p in s.parts]
        if any(g is None for g in grids):
            skipped["range"] += 1
            continue
        fermatas = np.zeros(n_steps, dtype=np.int8)  # phrase endings, used only for stats
        for n in s.parts[0].flatten().notes:
            if any(e.classes[0] == "Fermata" for e in n.expressions):
                fermatas[int(round((n.offset + shift) * 4))] = 1
        out.append({"name": name, "mode": int(k.mode == "minor"), "grid": np.stack(grids, 1),
                    "fermata": fermatas, "lead": int(shift * 4)})
    print(len(out), "chorales kept;", "skipped", skipped)
    print("major", sum(c["mode"] == 0 for c in out), "minor", sum(c["mode"] == 1 for c in out))
    with open("data/chorales.pkl", "wb") as f:
        pickle.dump(out, f)


if __name__ == "__main__":
    main()
