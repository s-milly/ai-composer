// Runs the recurrent networks trained in scripts/nets.py: the input at each step is a sum of
// embeddings (one per feature), followed by GRU layers and a linear output. Weights are stored as
// 8-bit numbers with one scale per row.

export async function loadNet(path) {
  const [meta, buf] = await Promise.all([fetch(path + ".json").then(r => r.json()), fetch(path + ".bin").then(r => r.arrayBuffer())]);
  const W = {};
  for (const [k, m] of Object.entries(meta.weights)) {
    const rows = m.shape.length > 1 ? m.shape[0] : 1;
    const n = m.shape.reduce((a, b) => a * b, 1), cols = n / rows;
    const q = new Int8Array(buf, m.q, n), s = new Float32Array(buf, m.s, rows), w = new Float32Array(n);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) w[r * cols + c] = q[r * cols + c] * s[r];
    W[k] = { w, rows, cols };
  }
  return new Net(meta, W);
}

class Net {
  constructor(meta, W) {
    this.meta = meta; this.W = W;
    this.H = meta.model.hidden; this.L = meta.model.layers; this.d = meta.model.d;
    this.feats = Object.keys(meta.model.features);
  }
  state() { return Array.from({ length: this.L }, () => new Float32Array(this.H)); }

  gru(l, x, h) {
    const H = this.H, wi = this.W[`rnn.weight_ih_l${l}`], wh = this.W[`rnn.weight_hh_l${l}`];
    const bi = this.W[`rnn.bias_ih_l${l}`].w, bh = this.W[`rnn.bias_hh_l${l}`].w;
    const gi = new Float32Array(3 * H), gh = new Float32Array(3 * H);
    for (let r = 0; r < 3 * H; r++) {
      let a = bi[r], b = bh[r];
      const oi = r * wi.cols, oh = r * H;
      for (let c = 0; c < wi.cols; c++) a += wi.w[oi + c] * x[c];
      for (let c = 0; c < H; c++) b += wh.w[oh + c] * h[c];
      gi[r] = a; gh[r] = b;
    }
    const out = new Float32Array(H);
    for (let j = 0; j < H; j++) {
      const r = 1 / (1 + Math.exp(-(gi[j] + gh[j])));
      const z = 1 / (1 + Math.exp(-(gi[H + j] + gh[H + j])));
      const n = Math.tanh(gi[2 * H + j] + r * gh[2 * H + j]);
      out[j] = (1 - z) * n + z * h[j];
    }
    return out;
  }

  // x: {feature: index}. Returns [logits, new state]; the old state is left untouched.
  step(state, x) {
    let v = new Float32Array(this.d);
    for (const f of this.feats) {
      const e = this.W[`emb.${f}.weight`], o = x[f] * e.cols;
      for (let i = 0; i < this.d; i++) v[i] += e.w[o + i];
    }
    const next = [];
    for (let l = 0; l < this.L; l++) { v = this.gru(l, v, state[l]); next.push(v); }
    const o = this.W["out.weight"], b = this.W["out.bias"].w, logits = new Float32Array(o.rows);
    for (let r = 0; r < o.rows; r++) { let a = b[r]; const off = r * o.cols; for (let c = 0; c < o.cols; c++) a += o.w[off + c] * v[c]; logits[r] = a; }
    return [logits, next];
  }
}

// Picks an index from logits at a temperature, skipping any index where ok(i) is false.
export function sample(logits, temp, ok = () => true, bias = null) {
  let max = -Infinity;
  const z = new Float32Array(logits.length);
  for (let i = 0; i < logits.length; i++) {
    z[i] = ok(i) ? (logits[i] + (bias ? bias[i] || 0 : 0)) / temp : -Infinity;
    if (z[i] > max) max = z[i];
  }
  if (max === -Infinity) return -1;
  let sum = 0;
  for (let i = 0; i < z.length; i++) { z[i] = z[i] === -Infinity ? 0 : Math.exp(z[i] - max); sum += z[i]; }
  let r = Math.random() * sum;
  for (let i = 0; i < z.length; i++) { r -= z[i]; if (r <= 0 && z[i] > 0) return i; }
  return z.findIndex(v => v > 0);
}
