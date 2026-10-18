"""Train the description reader: one linear classifier per question (style, mood, speed) on the
average GloVe vector of the words in a description.

Training text: the musicians' captions plus short phrases built from their tags, so the reader
sees both long and short descriptions. Scores in data/reader_metrics.json come from captions of
clips held out of training.

Because each classifier is linear in the average word vector, its score is just the average of
per-word scores. site/reader.bin stores those per-word scores (int8), so the browser needs no
word vectors at all, and the page can show which words drove each answer."""
import gzip, json, re, sys
import numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS
from reader_labels import aspects, labels, STYLES, MOODS, SPEEDS

N_VOCAB = int(sys.argv[1]) if len(sys.argv) > 1 else 40000
USE_BOW = (sys.argv[4] if len(sys.argv) > 4 else "1") == "1"
CW = sys.argv[6] if len(sys.argv) > 6 else "none"
HEADS = {"style": STYLES, "mood": MOODS, "speed": SPEEDS}
TOKEN = re.compile(r"[a-z0-9&'-]+")
STOP = set(ENGLISH_STOP_WORDS) - {"no", "not", "without"}
rng = np.random.default_rng(0)

words, vecs = [], []
with gzip.open("data/raw/glove/g100.gz", "rt", encoding="utf8") as f:
    next(f)
    for i, line in enumerate(f):
        if i >= N_VOCAB:
            break
        p = line.rstrip().split(" ")
        words.append(p[0]); vecs.append(np.asarray(p[1:], dtype=np.float32))
E = np.stack(vecs)
index = {w: i for i, w in enumerate(words)}


def tokens(text):
    return [t for t in TOKEN.findall(text.lower().replace("’", "'")) if t not in STOP and t in index]


def embed(text):
    ids = [index[t] for t in tokens(text)]
    x = np.zeros(E.shape[1] + len(BOW), dtype=np.float32)
    if ids:
        x[:E.shape[1]] = E[ids].mean(0)
        for i in ids:
            j = BOW.get(i)
            if j is not None:
                x[E.shape[1] + j] += 1 / len(ids)
    return x


d = pd.read_csv("data/raw/musiccaps/musiccaps-public.csv")
lab = pd.DataFrame([labels(a) for a in d.aspect_list])
test = rng.random(len(d)) < 0.2
# words that get their own learned weight: seen in at least MIN_DF training clips
MIN_DF = 3
from collections import Counter
df = Counter()
mode = sys.argv[2] if len(sys.argv) > 2 else "eval"
for i in (np.nonzero(~test)[0] if mode == "eval" else range(len(d))):
    df.update(set(index[t] for t in tokens(d.caption[i] + " " + " ".join(aspects(d.aspect_list[i])))))
BOW = {w: j for j, w in enumerate(sorted(w for w, c in df.items() if c >= MIN_DF))} if USE_BOW else {}


def phrases(raw, n=3):
    asp = aspects(raw)
    return [", ".join(rng.choice(asp, size=min(len(asp), rng.integers(1, 5)), replace=False)) for _ in range(n)]


def build(rows):
    X, Y = [], {h: [] for h in HEADS}
    for i in rows:
        for text in [d.caption[i]] + phrases(d.aspect_list[i]):
            X.append(embed(text))
            for h in HEADS:
                Y[h].append(lab[h][i] if pd.notna(lab[h][i]) else None)
    return np.stack(X), {h: np.array(v, dtype=object) for h, v in Y.items()}

train_rows = np.nonzero(~test)[0] if mode == "eval" else np.arange(len(d))
Xtr, Ytr = build(train_rows)
Xcap = np.stack([embed(t) for t in d.caption[test]])
Xasp = np.stack([embed(", ".join(aspects(a))) for a in d.aspect_list[test]])

models, metrics = {}, {"vocab": N_VOCAB, "test_clips": int(test.sum())}
for h, classes in HEADS.items():
    m = Ytr[h] != None
    clf = LogisticRegression(C=float(sys.argv[3]) if len(sys.argv) > 3 else 16.0, max_iter=3000, class_weight=(None if CW == "none" else "balanced"))
    clf.fit(Xtr[m], Ytr[h][m])
    models[h] = clf
    if mode == "eval":
        y = lab[h][test].to_numpy(dtype=object); k = pd.notna(lab[h][test]).to_numpy()
        base = pd.Series(Ytr[h][m]).value_counts().index[0]
        acc_cap = float((clf.predict(Xcap[k]) == y[k]).mean())
        acc_asp = float((clf.predict(Xasp[k]) == y[k]).mean())
        metrics[h] = {"n": int(k.sum()), "accuracy": acc_cap, "accuracy_tags": acc_asp,
                      "baseline": float((y[k] == base).mean()), "baseline_class": base, "classes": len(classes)}
        print(f"{h:6s} n={k.sum():4d} captions {acc_cap:.3f}  tags {acc_asp:.3f}  always-'{base}' {metrics[h]['baseline']:.3f}")

if mode == "eval":
    json.dump(metrics, open("data/reader_metrics.json", "w"), indent=1)
else:
    # per-word scores for every class of every head: W @ e_w; the bias is added once
    order = [(h, c) for h, cl in HEADS.items() for c in cl]
    W = np.stack([models[h].coef_[list(models[h].classes_).index(c)] for h, c in order])
    b = np.array([models[h].intercept_[list(models[h].classes_).index(c)] for h, c in order])
    S = E @ W[:, :E.shape[1]].T                    # (vocab, classes)
    for w, j in BOW.items():
        S[w] += W[:, E.shape[1] + j]
    keep = [i for i, w in enumerate(words) if w not in STOP and TOKEN.fullmatch(w)]
    S = S[keep]
    scale = np.abs(S).max(0) / 127
    q = np.round(S / scale).astype(np.int8)
    open("site/reader.bin", "wb").write(q.tobytes())
    json.dump({"heads": {h: cl for h, cl in HEADS.items()}, "order": [f"{h}:{c}" for h, c in order],
               "scale": scale.round(8).tolist(), "bias": b.round(6).tolist(), "words": [words[i] for i in keep],
               "stop": sorted(STOP)}, open("site/reader.json", "w"), separators=(",", ":"))
    print("exported", len(keep), "words")

if mode == "eval" and len(sys.argv) > 5:
    for text in sys.argv[5].split("|"):
        x = embed(text)[None]
        print(f"{text[:44]:44s}", " ".join(f"{h}={models[h].predict(x)[0]}({models[h].predict_proba(x).max():.2f})" for h in HEADS))
