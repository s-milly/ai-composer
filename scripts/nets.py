"""Small recurrent networks whose input is a sum of embeddings, one per feature. The same
structure runs in the browser (site/js/gru.js), so any model built here can be exported as-is."""
import json
import numpy as np, torch
from torch import nn


class EmbedGRU(nn.Module):
    def __init__(self, features, n_out, d=64, hidden=256, layers=2, dropout=0.25):
        super().__init__()
        self.features = dict(features)
        self.emb = nn.ModuleDict({k: nn.Embedding(n, d) for k, n in features.items()})
        self.drop = nn.Dropout(dropout)
        self.rnn = nn.GRU(d, hidden, layers, batch_first=True, dropout=dropout if layers > 1 else 0)
        self.out = nn.Linear(hidden, n_out)
        self.meta = {"features": self.features, "n_out": n_out, "d": d, "hidden": hidden, "layers": layers}

    def forward(self, x, h=None):
        e = sum(self.emb[k](x[k]) for k in self.features)
        y, h = self.rnn(self.drop(e), h)
        return self.out(self.drop(y)), h


def export(model, path, extra=None):
    """int8 weights with one scale per row, 4-byte aligned; writes path.bin and path.json."""
    blobs, offset, meta = [], 0, {}
    for k, w in model.state_dict().items():
        w = w.float().numpy()
        w2 = w.reshape(w.shape[0], -1) if w.ndim > 1 else w.reshape(1, -1)
        scale = np.abs(w2).max(1, keepdims=True) / 127 + 1e-12
        q = np.round(w2 / scale).astype(np.int8)
        pad = (-q.size) % 4
        meta[k] = {"shape": list(w.shape), "q": offset, "s": offset + q.size + pad}
        blobs += [q.tobytes(), b"\0" * pad, scale.astype(np.float32).ravel().tobytes()]
        offset += q.size + pad + scale.size * 4
    open(path + ".bin", "wb").write(b"".join(blobs))
    json.dump({"weights": meta, "model": model.meta, **(extra or {})}, open(path + ".json", "w"))
    return offset
