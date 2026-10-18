"""Train the melody model on every genre at once.

At each sixteenth note it predicts the next melody token (a new pitch, hold, or rest) from:
the token before, the pitch still sounding, the chord on this beat and the next beat, the
position in the bar and in a four-bar phrase, the genre, major or minor, and how busy the
song's melody is (few, some or many notes per bar). Genres are sampled equally, so the large
pop set does not drown out the others.

  python scripts/train_melody.py eval EPOCHS   # hold out 10% of songs, report how well it predicts them, export
  python scripts/train_melody.py final EPOCHS  # train on every song and export site/melody.*
"""
import json, pickle, sys, time
import numpy as np, torch
from torch import nn
from nets import EmbedGRU, export
from songdata import GENRES, HOLD, REST, N_PITCH, NO_CHORD, QUALITIES

torch.manual_seed(0); rng = np.random.default_rng(0); torch.set_num_threads(4)
mode = sys.argv[1] if len(sys.argv) > 1 else "eval"
EPOCHS = int(sys.argv[2]) if len(sys.argv) > 2 else 12
CROPS, LEN, BATCH = 2500, 256, 32
N_TOK = N_PITCH + 2

songs = [s for s in pickle.load(open("data/songs.pkl", "rb")) if s["genre"] in GENRES]
dens = np.array([(s["melody"] >= 2).sum() / (len(s["melody"]) / 16) for s in songs])
cuts = np.quantile(dens, [1 / 3, 2 / 3])
for s, d in zip(songs, dens):
    s["dens"] = int(np.searchsorted(cuts, d))
present = sorted({s["genre"] for s in songs}, key=GENRES.index)
held = rng.random(len(songs)) < (0.1 if mode == "eval" else 0)
FEATS = {"prev": N_TOK, "sound": N_PITCH + 1, "root": 13, "qual": len(QUALITIES), "nroot": 13, "nqual": len(QUALITIES),
         "beat": 16, "bar": 4, "genre": len(GENRES), "mode": 2, "dens": 3}


def features(s, start, n):
    mel = s["melody"][start:start + n]
    t = np.arange(start, start + n)
    prev = np.concatenate([[REST], mel[:-1]])
    sound = np.zeros(n, dtype=np.int64); cur = 0
    for i, tok in enumerate(prev):
        cur = 0 if tok == REST else cur if tok == HOLD else tok - 1
        sound[i] = cur
    b = np.minimum(t // 4, len(s["root"]) - 1); nb = np.minimum(b + 1, len(s["root"]) - 1)
    return {"prev": prev, "sound": sound, "root": s["root"][b], "qual": s["qual"][b], "nroot": s["root"][nb], "nqual": s["qual"][nb],
            "beat": t % 16, "bar": (t // 16) % 4, "genre": np.full(n, GENRES.index(s["genre"])), "mode": np.full(n, s["mode"]),
            "dens": np.full(n, s["dens"])}, mel


def crops(pool, k):
    out = []
    while len(out) < k:
        s = pool[rng.integers(len(pool))]
        bars = len(s["melody"]) // 16
        if bars < LEN // 16:
            continue
        start = rng.integers(0, bars - LEN // 16 + 1) * 16
        if (s["melody"][start:start + LEN] == REST).mean() > 0.6:
            continue
        out.append((s, start))
    return out


def batch(items):
    fs = [features(s, st, LEN) for s, st in items]
    x = {k: torch.as_tensor(np.stack([f[k] for f, _ in fs]).astype(np.int64)) for k in FEATS}
    return x, torch.as_tensor(np.stack([y for _, y in fs]).astype(np.int64))


train_by = {g: [s for s, h in zip(songs, held) if s["genre"] == g and not h] for g in present}
val = [s for s, h in zip(songs, held) if h]
model = EmbedGRU(FEATS, N_TOK)
opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=0.01)
steps_per = CROPS * len(present) // BATCH
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=EPOCHS * steps_per)
lossf = nn.CrossEntropyLoss()
val_items = crops(val, 400) if len(val) else []


def evaluate():
    model.eval(); res = {}
    with torch.no_grad():
        for g in present:
            its = [it for it in val_items if it[0]["genre"] == g]
            if not its:
                continue
            x, y = batch(its); lg, _ = model(x)
            on = y >= 2
            res[g] = {"nll": float(lossf(lg.reshape(-1, N_TOK), y.reshape(-1))),
                      "new_note_acc": float((lg.argmax(-1)[on] == y[on]).float().mean())}
    model.train(); return res


for ep in range(EPOCHS):
    t0 = time.time()
    items = sum((crops(train_by[g], CROPS) for g in present), [])
    rng.shuffle(items)
    for i in range(0, len(items) - BATCH + 1, BATCH):
        x, y = batch(items[i:i + BATCH])
        lg, _ = model(x)
        loss = lossf(lg.reshape(-1, N_TOK), y.reshape(-1))
        opt.zero_grad(); loss.backward(); nn.utils.clip_grad_norm_(model.parameters(), 1.0); opt.step(); sched.step()
    msg = f"ep {ep + 1} loss {loss.item():.3f} ({time.time() - t0:.0f}s)"
    if val_items:
        msg += " " + json.dumps({g: round(v["new_note_acc"], 3) for g, v in evaluate().items()})
    print(msg, flush=True)

if mode == "eval":
    json.dump(evaluate(), open("data/melody_metrics.json", "w"), indent=1)
if True:
    kb = export(model, "site/melody", {"genres": GENRES, "qualities": QUALITIES, "low": 52, "density_cuts": cuts.tolist(),
                                       "trained_genres": present})
    print("exported", kb // 1000, "KB")
torch.save(model.state_dict(), f"data/melody_{mode}.pt")
