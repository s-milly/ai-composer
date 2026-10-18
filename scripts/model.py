"""The composer network and the features it reads at each step.

Music is read as one long sequence: at every sixteenth note the soprano, alto, tenor and bass
each get a token, in that order. To predict voice v at time t the network sees
  - the token it just produced (previous voice, or the bass of the previous step),
  - the pitch each voice is currently sounding (voices above v already at time t,
    the rest still at t - 1), so a HOLD never hides which note is ringing,
  - which voice it is writing, where in the bar it is, major or minor,
    and how many bars are left before the end.
"""
import numpy as np
import torch
from torch import nn

N_TOK = 54          # HOLD, REST, 52 pitches
N_SOUND = 53        # silent + 52 pitches
N_BEAT, N_END = 16, 4
HOLD, REST = 0, 1


def features(grid, n_bars_total=None, start_beat=0):
    """grid: (steps, 4) tokens. Returns per-position input arrays for the flattened sequence."""
    steps = len(grid)
    if n_bars_total is None:
        n_bars_total = int(np.ceil((steps + start_beat) / 16))
    flat = grid.reshape(-1)
    prev = np.concatenate([[REST], flat[:-1]])
    # sounding pitch per voice after each step (0 = silent, else pitch token - 1)
    sound = np.zeros((steps + 1, 4), dtype=np.int64)
    for t in range(steps):
        for v in range(4):
            tok = grid[t, v]
            sound[t + 1, v] = sound[t, v] if tok == HOLD else (0 if tok == REST else tok - 1)
    n = steps * 4
    t_idx = np.repeat(np.arange(steps), 4)
    v_idx = np.tile(np.arange(4), steps)
    ctx = np.zeros((n, 4), dtype=np.int64)
    for u in range(4):
        # voices above the target are already written for time t
        ctx[:, u] = np.where(u < v_idx, sound[t_idx + 1, u], sound[t_idx, u])
    beat = (t_idx + start_beat) % 16
    end = np.clip(n_bars_total - 1 - (t_idx + start_beat) // 16, 0, N_END - 1)
    return dict(prev=prev, ctx=ctx, voice=v_idx, beat=beat, end=end), flat


class Composer(nn.Module):
    def __init__(self, d=48, hidden=256, layers=2, dropout=0.3):
        super().__init__()
        self.tok = nn.Embedding(N_TOK, d)
        self.sound = nn.ModuleList([nn.Embedding(N_SOUND, d) for _ in range(4)])
        self.voice = nn.Embedding(4, d)
        self.beat = nn.Embedding(N_BEAT, d)
        self.end = nn.Embedding(N_END, d)
        self.mode = nn.Embedding(2, d)
        self.drop = nn.Dropout(dropout)
        self.rnn = nn.GRU(d, hidden, layers, batch_first=True, dropout=dropout)
        self.out = nn.Linear(hidden, N_TOK)

    def embed(self, b):
        x = self.tok(b["prev"]) + self.voice(b["voice"]) + self.beat(b["beat"]) + self.end(b["end"])
        x = x + self.mode(b["mode"])[:, None, :]
        for u in range(4):
            x = x + self.sound[u](b["ctx"][..., u])
        return x

    def forward(self, b, h=None):
        y, h = self.rnn(self.drop(self.embed(b)), h)
        return self.out(self.drop(y)), h
