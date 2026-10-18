# AI Composer

Describe a song ("a slow, sad piano song for a rainy night") and two models turn it into music: one reads the description, the other writes a new four-part piece note by note, and a band plays it on a stage where each player's spotlight follows their part. The Song Maker tab lets you write your own song on a note grid with no AI involved.

Live page: https://s-milly.github.io/ai-composer/

## How it works

**Description reader** (`site/js/reader.js`)
- Words that name a style, mood, speed, instrument, key, length or tempo are read as-is.
- Everything else goes to linear classifiers (style: 10 choices, mood: 3, speed: 3) trained on the 5,521 musician-written descriptions in MusicCaps, using averaged GloVe word vectors plus a learned weight for each word.
- `scripts/reader_labels.py` turns the MusicCaps tags into labels; `scripts/reader_train.py 40000 eval` scores the reader on 20% of clips held out of training, and `scripts/reader_train.py 40000 final` exports per-word scores to `site/reader.bin`.

**Composer** (`site/js/composer.js`)
- A 2-layer GRU (PyTorch) trained on 306 Bach chorales from the music21 corpus, run by hand in JavaScript from 8-bit weights.
- `scripts/prepare.py`, `scripts/train.py eval|final`, `scripts/export.py`, `scripts/evaluate.py`.

**Band** (`site/js/arrange.js`, `site/js/audio.js`, `site/js/stage.js`)
- Each of the 10 styles sets the band, a speed range, a drum beat and how each part is played (held, repeated eighth notes, arpeggios, jazz comping and walking bass, strumming, oom-pah). These are fixed rules.
- Instruments are FluidR3 soundfont recordings (`scripts/fetch_samples.py`); drums are synthesized in the browser.

**Song Maker** (`site/js/maker.js`): a note grid for each part plus a drum grid, saved in the browser, with MIDI export (`site/js/midi.js`).

## Run it

```
pip install music21 torch scikit-learn pandas
python scripts/prepare.py
python scripts/train.py eval 60 && python scripts/train.py final 60
python scripts/export.py final && python scripts/evaluate.py final
# reader: needs data/raw/musiccaps/musiccaps-public.csv and data/raw/glove/g100.gz (glove-wiki-gigaword-100)
python scripts/reader_train.py 40000 eval && python scripts/reader_train.py 40000 final
python scripts/build_page_data.py
python -m http.server
```

## Credits

- Descriptions: [MusicCaps](https://research.google/resources/datasets/musiccaps/) by Google (Agostinelli et al., 2023), CC BY-SA 4.0. The description reader files (`site/reader.bin`, `site/reader.json`) are derived from it and shared under CC BY-SA 4.0.
- Word vectors: [GloVe](https://nlp.stanford.edu/projects/glove/) (Pennington, Socher and Manning, 2014), public domain (PDDL).
- Bach chorales from the [music21](https://www.music21.org/) corpus. The chorales are in the public domain.
- Instrument sounds: FluidR3 General MIDI soundfont by Frank Wen, rendered by [gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts), CC BY 3.0. Every third note kept, trimmed to 3.5 seconds and converted to mono.
