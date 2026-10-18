"""Score songs on four music theory checks and write site/stats.json for the page.

Compared: every chorale the model learned from, songs the model writes (same sampler as the
page), and songs of random notes with Bach-like rhythms. All grids are in C major / A minor."""
import json, pickle, sys
import numpy as np, torch
from model import Composer, HOLD, REST
from sample import generate, RANGES, LOW

N_SONGS, BARS, TEMP = 200, 8, 0.9
torch.set_num_threads(1)
MAJOR = {0, 2, 4, 5, 7, 9, 11}
MINOR = {9, 11, 0, 2, 4, 5, 7, 6, 8}  # natural, harmonic and melodic minor on A


def chord_templates():
    shapes = [(0, 4, 7), (0, 3, 7), (0, 3, 6),                        # major, minor, diminished
              (0, 4, 7, 10), (0, 3, 7, 10), (0, 4, 7, 11), (0, 3, 6, 10), (0, 3, 6, 9)]  # sevenths
    out = set()
    for s in shapes:
        for r in range(12):
            out.add(frozenset((r + i) % 12 for i in s))
            if len(s) == 4:  # a seventh chord often drops its fifth
                out.add(frozenset((r + i) % 12 for i in (s[0], s[1], s[3])))
    return out


TEMPLATES = chord_templates()


def sounding(grid):
    """MIDI pitch each voice is sounding at each step (0 = silent) and whether it started there."""
    pit = np.zeros(grid.shape, dtype=int)
    cur = [0, 0, 0, 0]
    for t in range(len(grid)):
        for v in range(4):
            tok = grid[t, v]
            if tok == REST:
                cur[v] = 0
            elif tok != HOLD:
                cur[v] = tok - 2 + LOW
            pit[t, v] = cur[v]
    return pit, grid >= 2


def score(grid, minor):
    pit, onset = sounding(grid)
    scale = MINOR if minor else MAJOR
    notes = pit[onset]
    in_key = np.mean([p % 12 in scale for p in notes])
    beats = [t for t in range(0, len(grid), 4) if (pit[t] > 0).all()]
    chords = np.mean([frozenset(pit[t] % 12) in TEMPLATES for t in beats])
    changes, clean = 0, 0
    for t in range(1, len(grid)):
        if not onset[t].any() or not (pit[t] > 0).all() or not (pit[t - 1] > 0).all():
            continue
        changes += 1
        bad = False
        for i in range(4):
            for j in range(i + 1, 4):
                a0, a1, b0, b1 = pit[t - 1, i], pit[t, i], pit[t - 1, j], pit[t, j]
                if a0 == a1 or b0 == b1:
                    continue
                if (a0 - b0) % 12 == (a1 - b1) % 12 and (a1 - b1) % 12 in (0, 7) and np.sign(a1 - a0) == np.sign(b1 - b0):
                    bad = True
        clean += not bad
    mel = [p for p in pit[onset[:, 0], 0]]
    leaps = np.abs(np.diff(mel))
    steps = np.mean((leaps >= 1) & (leaps <= 2)) if len(leaps) else 0.0
    last = pit[np.nonzero((pit > 0).all(1))[0][-1]]
    tonic = 9 if minor else 0
    home = {frozenset({tonic, (tonic + 3) % 12, (tonic + 7) % 12}), frozenset({tonic, (tonic + 4) % 12, (tonic + 7) % 12})}
    pcs = frozenset(last % 12)
    cadence = last[3] % 12 == tonic and any(pcs <= h for h in home)
    return dict(in_key=in_key, chords=chords, steps=steps, parallels=(clean, changes), cadence=float(cadence))


def random_song(rng, durs):
    steps = BARS * 16
    grid = np.full((steps, 4), HOLD, dtype=int)
    for v in range(4):
        t = 0
        while t < steps:
            lo, hi = RANGES[v]
            grid[t, v] = rng.integers(lo, hi + 1) - LOW + 2
            t += int(rng.choice(durs[v]))
    return grid


def summarize(scores):
    clean = sum(s["parallels"][0] for s in scores); total = sum(s["parallels"][1] for s in scores)
    return dict(in_key=float(np.mean([s["in_key"] for s in scores])), chords=float(np.mean([s["chords"] for s in scores])),
                steps=float(np.mean([s["steps"] for s in scores])), parallels=clean / total, cadence=float(np.mean([s["cadence"] for s in scores])))


def main():
    chorales = pickle.load(open("data/chorales.pkl", "rb"))
    rng = np.random.default_rng(7)
    bach = summarize([score(c["grid"], c["mode"]) for c in chorales])
    # note lengths per voice, taken from Bach, for the random baseline
    durs = [[], [], [], []]
    for c in chorales:
        _, on = sounding(c["grid"])
        for v in range(4):
            idx = np.nonzero(on[:, v])[0]
            durs[v] += list(np.diff(idx))
    rand = summarize([score(random_song(rng, durs), i % 2) for i in range(N_SONGS)])
    name = sys.argv[1] if len(sys.argv) > 1 else "final"
    model = Composer(); model.load_state_dict(torch.load(f"data/composer_{name}_q.pt")); model.eval()
    gens = []
    for i in range(N_SONGS):
        g = generate(model, BARS, i % 2, TEMP, rng=rng)
        gens.append(score(g, i % 2))
        if i % 50 == 49:
            print(i + 1, "songs", flush=True)
    mod = summarize(gens)
    labels = {"in_key": "Notes in the key", "chords": "Beats on a standard chord",
              "steps": "Melody moves that are a step (1 or 2 half steps)", "cadence": "Songs that end on the home chord"}
    rules = [dict(id=k, label=labels[k], bach=bach[k], model=mod[k], random=rand[k]) for k in labels]
    print("parallels", bach["parallels"], mod["parallels"], rand["parallels"])
    for r in rules:
        print(f"{r['label']:50s} bach {r['bach']:.3f} model {r['model']:.3f} random {r['random']:.3f}")
    ev = json.load(open("data/eval_metrics.json"))
    method = json.load(open("scripts/method.json"))
    json.dump(dict(chorales=len(chorales), songs=N_SONGS, temperature=TEMP, eval=ev, rules=rules, method=method),
              open("site/stats.json", "w"), indent=1)


if __name__ == "__main__":
    main()
