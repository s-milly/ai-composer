"""Download instrument recordings (FluidR3 General MIDI soundfont, CC BY 3.0, rendered by
gleitz/midi-js-soundfonts) every third semitone. The page shifts the nearest one by at most one
semitone to play any note. No vocal instruments are included."""
import os, subprocess, sys, urllib.request

BASE = "https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/FluidR3_GM"
NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
INSTRUMENTS = ["acoustic_grand_piano", "electric_piano_1", "harpsichord", "church_organ", "marimba", "vibraphone",
               "acoustic_guitar_nylon", "orchestral_harp", "violin", "viola", "cello", "contrabass",
               "string_ensemble_1", "pizzicato_strings", "flute", "oboe", "clarinet", "bassoon",
               "trumpet", "french_horn", "trombone", "tuba", "acoustic_bass", "alto_sax",
               "electric_guitar_clean", "overdriven_guitar", "acoustic_guitar_steel", "banjo", "electric_bass_finger",
               "electric_bass_pick", "synth_bass_1", "lead_2_sawtooth", "pad_2_warm", "music_box", "celesta",
               "xylophone", "glockenspiel", "steel_drums", "harmonica", "accordion", "brass_section", "timpani",
               "tremolo_strings", "tenor_sax"]
NOTES = range(31, 91, 3)  # G1 to Gb6 covers every voice after transposing to any key

for inst in INSTRUMENTS:
    os.makedirs(f"site/samples/{inst}", exist_ok=True)
    for m in NOTES:
        name = f"{NAMES[m % 12]}{m // 12 - 1}"
        dst = f"site/samples/{inst}/{m}.mp3"
        if os.path.exists(dst):
            continue
        raw = urllib.request.urlopen(f"{BASE}/{inst}-mp3/{name}.mp3").read()
        tmp = dst + ".src.mp3"
        open(tmp, "wb").write(raw)
        # trim to 3.5 s with a short fade, mono 64 kbps keeps the whole set small
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", tmp, "-t", "3.5", "-af", "afade=t=out:st=3.1:d=0.4",
                        "-ac", "1", "-b:a", "64k", dst], check=True)
        os.remove(tmp)
    print(inst, flush=True)
