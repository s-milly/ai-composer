"""Train the chord model: given the genre, major or minor, the position in an eight-bar phrase and
the chord before, it predicts the next chord, one chord per half bar. Pop, rock, folk and
classical progressions come from data/songs.pkl; jazz progressions come from the iReal Pro
lead sheets of about 1,200 standards in the parkR package. Exports site/chords.*."""
import pickle, re, sys, time
import numpy as np, pyreadr, torch
from torch import nn
from nets import EmbedGRU, export
from songdata import GENRES, QUALITIES, NO_CHORD, pc_of

torch.manual_seed(0); rng = np.random.default_rng(1); torch.set_num_threads(int(sys.argv[2]) if len(sys.argv) > 2 else 4)
EPOCHS = int(sys.argv[1]) if len(sys.argv) > 1 else 20
NQ = len(QUALITIES); N_TOK = 12 * NQ + 1; NONE = N_TOK - 1
LEN = 32  # half bars per training crop (16 bars)


def tok(root, qual):
    return NONE if root == NO_CHORD else int(root) * NQ + int(qual)


seqs = []
for s in pickle.load(open("data/songs.pkl", "rb")):
    r, q = s["root"], s["qual"]
    half = [tok(r[b], q[b]) for b in range(0, len(r) - 1, 2)]
    seqs.append((s["genre"], s["mode"], np.array(half)))


def ireal_quality(q):
    if q.startswith("m7b5"): return "hdim7"
    if q.startswith("o"): return "dim"
    if q.startswith("maj7") or q.startswith("maj9") or q.startswith("maj711"): return "maj7"
    if q.startswith("minmaj"): return "min"
    if q.startswith("min7") or q.startswith("min9") or q.startswith("min11"): return "min7"
    if q.startswith("min"): return "min"
    if "sus" in q: return "sus"
    if q[:1] in ("7", "9") or q.startswith("13") or q.startswith("11"): return "7"
    if q.startswith("+"): return "aug"
    return "maj"


irb = pyreadr.read_r("data/raw/parkr/irb.rda")["irb"]
n_jazz = 0
for _, g in irb[irb.time == "4/4"].groupby("id", sort=False):
    k = g.key.iloc[0].split("-")
    try:
        tonic, minor = pc_of(k[0]), k[1] == "min"
    except (KeyError, IndexError):
        continue
    shift = (-(tonic - (9 if minor else 0))) % 12
    half = []
    for ch, dur in zip(g.chord, g.duration):
        m = re.match(r"^([A-G][b#]?)(.*)$", str(ch).split("/")[0])
        if not m:
            continue
        t = tok((pc_of(m.group(1)) + shift) % 12, QUALITIES.index(ireal_quality(m.group(2))))
        half += [t] * max(1, int(round(dur / 2)))
    if len(half) >= 16:
        # standards usually repeat their chorus; two passes give the model the turnaround
        seqs.append(("jazz", int(minor), np.array(half + half)))
        n_jazz += 1
print("songs per genre", {g: sum(1 for s in seqs if s[0] == g) for g in GENRES}, flush=True)

FEATS = {"proot": 13, "pqual": NQ, "slot": 16, "genre": len(GENRES), "mode": 2}


def features(genre, mode, half, start, n):
    seq = half[start:start + n]
    prev = np.concatenate([[NONE], seq[:-1]])
    return {"proot": np.where(prev == NONE, 12, prev // NQ), "pqual": np.where(prev == NONE, 0, prev % NQ),
            "slot": (np.arange(start, start + n)) % 16, "genre": np.full(n, GENRES.index(genre)), "mode": np.full(n, mode)}, seq


by = {g: [s for s in seqs if s[0] == g and len(s[2]) >= LEN] for g in GENRES}
by = {g: v for g, v in by.items() if v}
model = EmbedGRU(FEATS, N_TOK, d=32, hidden=160, layers=1, dropout=0.1)
opt = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=0.01)
lossf = nn.CrossEntropyLoss()
for ep in range(EPOCHS):
    t0 = time.time(); tot = 0
    for _ in range(60):
        items = []
        for g, pool in by.items():
            for _ in range(16):
                gg, md, half = pool[rng.integers(len(pool))]
                st = rng.integers(0, (len(half) - LEN) // 2 + 1) * 2
                items.append(features(gg, md, half, st, LEN))
        x = {k: torch.as_tensor(np.stack([f[k] for f, _ in items]).astype(np.int64)) for k in FEATS}
        y = torch.as_tensor(np.stack([s for _, s in items]).astype(np.int64))
        lg, _ = model(x)
        loss = lossf(lg.reshape(-1, N_TOK), y.reshape(-1))
        opt.zero_grad(); loss.backward(); opt.step(); tot += loss.item()
    print(f"ep {ep + 1} loss {tot / 60:.3f} ({time.time() - t0:.0f}s)", flush=True)

kb = export(model, "site/chords", {"genres": GENRES, "qualities": QUALITIES, "trained_genres": list(by)})
print("exported", kb // 1000, "KB")
