"""Write the trained network to site/model.bin (int8 weights, one scale per row) plus
site/model.json (shapes and offsets) so the page can run it without any library."""
import json, sys
import numpy as np, torch
from model import Composer

name = sys.argv[1] if len(sys.argv) > 1 else "final"
sd = torch.load(f"data/composer_{name}.pt")
meta, blobs, offset = {}, [], 0
for k, w in sd.items():
    w = w.float().numpy()
    w2 = w.reshape(w.shape[0], -1) if w.ndim > 1 else w.reshape(1, -1)
    scale = np.abs(w2).max(1, keepdims=True) / 127 + 1e-12
    q = np.round(w2 / scale).astype(np.int8)
    scales = scale.astype(np.float32).ravel()
    # the scales are read as a Float32Array, which must start on a 4-byte boundary
    pad = (-q.size) % 4
    meta[k] = {"shape": list(w.shape), "q": offset, "s": offset + q.size + pad}
    blobs += [q.tobytes(), b"\0" * pad, scales.tobytes()]
    offset += q.size + pad + scales.nbytes
    sd[k] = torch.as_tensor((q * scale).reshape(w.shape))
open("site/model.bin", "wb").write(b"".join(blobs))
json.dump(meta, open("site/model.json", "w"))
torch.save(sd, f"data/composer_{name}_q.pt")
print(f"{offset/1e3:.0f} KB")
