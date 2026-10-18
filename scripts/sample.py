"""Generate music with the trained network, using the same rules as the web page."""
import numpy as np, torch
from model import Composer, HOLD, REST, N_TOK

LOW = 33
# pitch ranges per voice in C major / A minor (MIDI), roughly Bach's 1st to 99th percentile
RANGES = [(60, 81), (53, 74), (48, 69), (36, 62)]
ENDING_TRIES = 8


def tok_of(midi):
    return midi - LOW + 2


def ends_home(sound, minor):
    """True if every part is sounding and the last chord is the home chord with the tonic in the bass."""
    if (sound == 0).any():
        return False
    pcs = {(s - 1 + LOW) % 12 for s in sound}
    tonic = 9 if minor else 0
    bass = (sound[3] - 1 + LOW) % 12
    return bass == tonic and (pcs <= {tonic, (tonic + 3) % 12, (tonic + 7) % 12} or pcs <= {tonic, (tonic + 4) % 12, (tonic + 7) % 12})


def generate(model, n_bars=8, minor=0, temperature=0.9, melody=None, rng=None):
    """Return a (steps, 4) token grid. If melody is given (steps tokens), the soprano is kept
    and only alto, tenor and bass are written. If the song does not end on the home chord,
    the last two bars are written again, up to ENDING_TRIES times."""
    rng = rng or np.random.default_rng()
    model.eval()
    steps = n_bars * 16
    grid = np.zeros((steps, 4), dtype=np.int64)
    sound = np.zeros(4, dtype=np.int64)  # sounding pitch token - 1, 0 = silent
    prev, h = REST, None
    redo = max(0, n_bars - 2) * 16
    saved = None
    tries = 0
    t = 0
    with torch.no_grad():
        while t < steps:
            if t == redo and saved is None:
                saved = (sound.copy(), prev, h)
            new = sound.copy()
            for v in range(4):
                ctx = [new[u] if u < v else sound[u] for u in range(4)]
                b = {"prev": torch.tensor([[prev]]), "ctx": torch.tensor([[ctx]]), "voice": torch.tensor([[v]]),
                     "beat": torch.tensor([[t % 16]]), "end": torch.tensor([[min(3, n_bars - 1 - t // 16)]]),
                     "mode": torch.tensor([minor])}
                logits, h = model(b, h)
                if melody is not None and v == 0:
                    tok = int(melody[t])
                else:
                    tok = pick(logits[0, 0].numpy(), v, t, sound, new, temperature, rng)
                grid[t, v] = tok
                if tok != HOLD:
                    new[v] = tok - 1
                prev = tok
            sound = new
            t += 1
            if t == steps and not ends_home(sound, minor) and tries < ENDING_TRIES - 1:
                tries += 1
                sound, prev, h = saved[0].copy(), saved[1], saved[2]
                t = redo
    return grid


def pick(logits, v, t, sound, new, temperature, rng):
    mask = np.full(N_TOK, False)
    lo, hi = RANGES[v]
    mask[tok_of(lo):tok_of(hi) + 1] = True
    if v > 0 and new[v - 1] > 0:  # stay below the voice above (no crossing)
        mask[min(N_TOK, new[v - 1] + 2):] = False
    mask[HOLD] = t > 0 and sound[v] > 0
    # no parallel fifths or octaves against any part already written at this step
    blocked = mask.copy()
    for tok in np.nonzero(mask)[0]:
        if tok == HOLD or sound[v] == 0:
            continue
        b0, b1 = sound[v], tok - 1
        for u in range(v):
            a0, a1 = sound[u], new[u]
            if a0 == 0 or a0 == a1 or b0 == b1 or np.sign(a1 - a0) != np.sign(b1 - b0):
                continue
            if (a1 - b1) % 12 in (0, 7) and (a0 - b0) % 12 == (a1 - b1) % 12:
                blocked[tok] = False
    if blocked.any():
        mask = blocked
    z = np.where(mask, logits / temperature, -np.inf)
    p = np.exp(z - z.max()); p /= p.sum()
    return int(rng.choice(N_TOK, p=p))
