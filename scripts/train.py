"""Train the composer. `python scripts/train.py eval` holds out 15% of chorales and reports
how well the network predicts Bach's next note; `python scripts/train.py final` trains on all."""
import json, pickle, sys, time
import numpy as np, torch
from torch import nn
from model import Composer, features, HOLD, REST

torch.manual_seed(0); np.random.seed(0); torch.set_num_threads(2)
mode_arg = sys.argv[1] if len(sys.argv) > 1 else "eval"
EPOCHS = int(sys.argv[2]) if len(sys.argv) > 2 else 60
chorales = pickle.load(open("data/chorales.pkl", "rb"))


def trim(c):
    g = c["grid"]
    # drop the rests added in front of a pickup and after the last chord, so "bars left"
    # counts down to the real ending
    playing = np.nonzero((g != REST).any(1))[0]
    first, last = playing[0], playing[-1]
    return g[first:last + 1], first % 16


def to_item(c):
    g, start = trim(c)
    f, y = features(g, start_beat=start)
    f = {k: torch.as_tensor(v) for k, v in f.items()}
    f["mode"] = torch.tensor(c["mode"])
    return f, torch.as_tensor(y.astype(np.int64))


def batchify(items):
    L = max(len(y) for _, y in items)
    pad = lambda t, val: torch.nn.functional.pad(t, (0, 0, 0, L - len(t)) if t.dim() == 2 else (0, L - len(t)), value=val)
    b = {k: torch.stack([pad(f[k], 0) for f, _ in items]) for k in ["prev", "ctx", "voice", "beat", "end"]}
    b["mode"] = torch.stack([f["mode"] for f, _ in items])
    return b, torch.stack([pad(y, -100) for _, y in items])


idx = np.random.permutation(len(chorales))
n_val = int(0.15 * len(chorales)) if mode_arg == "eval" else 0
val_c = [chorales[i] for i in idx[:n_val]]
tr_c = [chorales[i] for i in idx[n_val:]]
tr_items = [to_item(c) for c in tr_c]
val_items = [to_item(c) for c in val_c]

model = Composer()
opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=0.01)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=EPOCHS * int(np.ceil(len(tr_items) / 16)))
loss_fn = nn.CrossEntropyLoss(ignore_index=-100)


def evaluate(items):
    model.eval()
    tot, n, hit, onset_hit, onset_n = 0.0, 0, 0, 0, 0
    with torch.no_grad():
        for i in range(0, len(items), 16):
            b, y = batchify(items[i:i + 16])
            logits, _ = model(b)
            m = y != -100
            tot += nn.functional.cross_entropy(logits[m], y[m], reduction="sum").item(); n += m.sum().item()
            pred = logits.argmax(-1)
            hit += (pred[m] == y[m]).sum().item()
            o = m & (y > REST)
            onset_hit += (pred[o] == y[o]).sum().item(); onset_n += o.sum().item()
    model.train()
    return tot / n, hit / n, onset_hit / onset_n


for ep in range(EPOCHS):
    t0 = time.time()
    perm = np.random.permutation(len(tr_items))
    for i in range(0, len(perm), 16):
        b, y = batchify([tr_items[j] for j in perm[i:i + 16]])
        logits, _ = model(b)
        loss = loss_fn(logits.reshape(-1, logits.shape[-1]), y.reshape(-1))
        opt.zero_grad(); loss.backward(); nn.utils.clip_grad_norm_(model.parameters(), 1.0); opt.step(); sched.step()
    if val_items and (ep % 5 == 4 or ep == EPOCHS - 1):
        nll, acc, oacc = evaluate(val_items)
        print(f"ep {ep+1} train {loss.item():.3f} val nll {nll:.3f} acc {acc:.3f} new-note acc {oacc:.3f} ({time.time()-t0:.0f}s)", flush=True)

if val_items:
    nll, acc, oacc = evaluate(val_items)
    json.dump({"val_chorales": len(val_items), "train_chorales": len(tr_items), "val_nll": nll,
               "val_acc": acc, "val_new_note_acc": oacc}, open("data/eval_metrics.json", "w"), indent=1)
torch.save(model.state_dict(), f"data/composer_{mode_arg}.pt")
