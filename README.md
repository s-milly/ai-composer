# AI Composer

A recurrent neural network trained on 306 Bach chorales that writes new four-part music. Pick an instrument for each part (24 to choose from, no vocals), a key, a length and a speed, and the model composes a piece note by note in your browser.

Live page: https://s-milly.github.io/ai-composer/

## How it works

- `scripts/prepare.py` turns the four-part 4/4 chorales in the music21 corpus into sixteenth-note grids of tokens (new note, hold, rest), moved to C major or A minor.
- `scripts/model.py` is the network: a 2-layer GRU (256 units) in PyTorch. At each step it sees the token it just wrote, the note each part is holding, which part it is writing, the beat, the mode and how many bars are left.
- `scripts/train.py eval` trains on 85% of the chorales and grades next-note predictions on the other 15%. `scripts/train.py final` trains on all of them.
- `scripts/export.py` compresses the weights to 8-bit numbers (`site/model.bin`, `site/model.json`). `index.html` runs the network in plain JavaScript.
- `scripts/evaluate.py` scores generated songs, real chorales and random notes on four music theory checks and writes `site/stats.json`.
- `scripts/fetch_samples.py` downloads the instrument sounds.

## Run it

```
pip install music21 torch
python scripts/prepare.py
python scripts/train.py eval 60
python scripts/train.py final 60
python scripts/export.py final
python scripts/evaluate.py
python -m http.server
```

## Credits

- Bach chorales from the [music21](https://www.music21.org/) corpus. The chorales are in the public domain.
- Instrument sounds: FluidR3 General MIDI soundfont by Frank Wen, rendered by [gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts), licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Every third note kept, trimmed to 3.5 seconds and converted to mono.
