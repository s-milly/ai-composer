# Music Composer

Describe a song ("a loud, hype rock walk-up song", "chill late night jazz with a saxophone") and AI writes it: one model reads the description, a chord model writes a progression in that genre, a melody model writes a tune over the chords, and a band plays it on a stage where each player's spotlight follows their part. The Song Maker tab lets you write your own song on a note grid with no AI involved.

Live page: https://s-milly.github.io/music-composer/

## How it works

**Description reader** (`site/js/reader.js`): words that name a style, mood, speed, instrument, key or length are read as-is; everything else goes to linear classifiers on averaged GloVe word vectors, trained on the 5,521 musician-written MusicCaps descriptions (`scripts/reader_labels.py`, `scripts/reader_train.py`).

**Training data** (`scripts/prepare_genres.py` writes `data/songs.pkl`): melodies with chords, moved to C major or A minor, on a sixteenth-note grid.
- pop: POP909 (909 songs) and the CoCoPops Billboard subset
- rock: the CoCoPops Rolling Stone 200
- folk: the Nottingham Music Database (Jukedeck's cleaned version)
- classical: Bach chorales and Haydn, Mozart and Beethoven string quartets from the music21 corpus, plus sonatas, quartets, trio sonatas, suites and songs with expert chord labels from 23 DCML corpora (top line of the first staff as the melody)
- lead sheets in several genres: OpenEWLD (public domain songs, genre from Discogs) and the Chord Melody Dataset (jazz standards and pop hits; genres in `scripts/cmd_genres.txt`)
- jazz chord changes: iReal Pro lead sheets of about 1,200 standards from the parkR package
- pop chord changes: McGill Billboard chord charts (from ChoCo), used by the chord model only
- jazz melodies: the Weimar Jazz Database, if `data/raw/wjazzd/wjazzd.db` is present

**Chord model** (`scripts/train_chords.py` -> `site/chords.*`): a GRU that writes one chord per half bar, conditioned on genre, major or minor and the position in the phrase.

**Melody model** (`scripts/train_melody.py` -> `site/melody.*`): a 2-layer GRU that writes one sixteenth note at a time, conditioned on genre, the current and next chord, the beat, the bar in the phrase, major or minor and how busy the melody should be. Genres are sampled equally in training. The model on the page was trained on all 3,307 songs and solos that are at least 16 bars long; a run with 10% of them kept aside measures how well it predicts music it has not seen (`data/melody_metrics.json`).

**Song writer** (`site/js/writer.js`): songs of 8 to 32 bars (picked on the page, or read from the description, like "a one minute song"). Phrases follow forms like A A' B A'; 24 and 32 bar songs add a chorus, and 32 bar songs play the verse and chorus twice. The answering phrase repeats the first three bars and comes home, and the song ends on the home note.

**Band** (`site/js/arrange.js`, `site/js/audio.js`, `site/js/stage.js`): each of the 10 styles sets the band, a speed range, a drum beat and how each part plays the chords (pads, arpeggios, stabs, power chords, strumming, fingerpicking, jazz comping over a walking bass, march oom-pah). Instruments are FluidR3 soundfont recordings (`scripts/fetch_samples.py`); drums are synthesized in the browser.

**Song Maker** (`site/js/maker.js`): a note grid for each part plus a drum grid, saved in the browser, with MIDI export (`site/js/midi.js`).

## Run it

```
pip install music21 torch scikit-learn pandas pretty_midi pyreadr
python scripts/prepare.py            # Bach chorales from the music21 corpus
python scripts/prepare_genres.py     # needs the raw datasets in data/raw (see the script)
python scripts/train_chords.py 25
python scripts/train_melody.py eval 18     # optional: held-out check
python scripts/train_melody.py final 18
python scripts/reader_train.py 40000 final
python -m http.server
```

## Credits

- POP909 (Wang et al., ISMIR 2020), MIT license.
- CoCoPops (Arthur and Condit-Schultz, ISMIR 2023), including the Rolling Stone corpus of de Clercq and Temperley and the McGill Billboard dataset of Burgoyne, Wild and Fujinaga.
- Nottingham Music Database, cleaned by Jukedeck.
- music21 corpus (Bach chorales, string quartets by Haydn, Mozart and Beethoven), public domain music.
- DCML corpora (Hentschel et al., Scientific Data 2025; Neuwirth et al. 2018 for the Beethoven quartets), CC BY-NC-SA 4.0. The melody model files (`site/melody.bin`, `site/melody.json`) are derived from them and shared under CC BY-NC-SA 4.0.
- OpenEWLD by Federico Simonetta, MIT license.
- Chord Melody Dataset by Steve Hiehn, MIT license.
- McGill Billboard chord annotations (Burgoyne, Wild and Fujinaga, 2011), via ChoCo (de Berardinis et al., 2023).
- iReal Pro chord changes from parkR by Klaus Frieler, MIT license.
- MusicCaps by Google (Agostinelli et al., 2023), CC BY-SA 4.0. The description reader files (`site/reader.bin`, `site/reader.json`) are derived from it and shared under CC BY-SA 4.0.
- GloVe word vectors (Pennington, Socher and Manning, 2014), public domain.
- Instrument sounds: FluidR3 General MIDI soundfont by Frank Wen, rendered by gleitz/midi-js-soundfonts, CC BY 3.0. Every third note kept, trimmed to 3.5 seconds and converted to mono.
