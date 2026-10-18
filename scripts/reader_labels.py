"""Turn the musicians' aspect tags in MusicCaps into labels for the description reader.

Three questions, each with a few answers:
  style  which of the page's 10 band styles fits best
  mood   bright (major key), sad or dark (both minor key)
  speed  slow, medium or fast
A clip gets no label for a question when its tags say nothing about it or point two ways.
"""
import ast, re

STYLES = ["classical", "ballad", "pop", "rock", "jazz", "folk", "march", "cinematic", "lullaby", "spooky"]
MOODS = ["bright", "sad", "dark"]
SPEEDS = ["slow", "medium", "fast"]

# checked in this order, so a more specific style wins (a "horror movie soundtrack" is spooky,
# a "soft rock ballad" is a ballad)
STYLE_RULES = [
    ("march", r"\bmarch(ing)?\b|military|brass band"),
    ("spooky", r"horror|eerie|scary|spooky|creepy|suspense"),
    ("lullaby", r"lullaby|nursery|children.?s song|meditation|new age|^ambient( music| synth)?$"),
    ("cinematic", r"movie|soundtrack|cinematic|\bepic\b|film score"),
    ("jazz", r"jazz|\bswing\b|blues|lounge|bossa"),
    ("folk", r"\bfolk\b|country|bluegrass|celtic"),
    ("ballad", r"ballad|love song|^r&b|^soul( music)?$|neo-soul"),
    ("rock", r"\brock\b|metal|punk|grunge"),
    ("pop", r"\bpop\b|dance|\bedm\b|techno|\bhouse\b|disco|\bclub\b|electro|hip hop|\brap\b|\btrap\b|funk"),
    ("classical", r"classical|baroque|chamber music|string quartet|orchestra|hymn|church music|opera"),
]
MOOD_RULES = [
    ("bright", r"^(happy|cheerful|joyful|fun|playful|uplifting|positive|bright|joyous|feel good|carefree)\b"),
    ("sad", r"^(sad|melanchol|sorrow|mournful|heartbreak|somber|sombre|depress|grief|gloomy|lonely)"),
    ("dark", r"^(eerie|scary|spooky|creepy|horror|ominous|dark|suspense|menacing|sinister|haunting|mysterious|tense)"),
]
SPEED_RULES = [
    ("slow", r"^(slow tempo|slow|slower tempo|very slow tempo|slow paced)$"),
    ("medium", r"^(medium tempo|moderate tempo|mid-tempo|mid tempo|medium paced)$"),
    ("fast", r"^(fast tempo|fast|uptempo|up tempo|fast paced|faster tempo|very fast tempo|medium fast tempo|medium fast)$"),
]


def aspects(raw):
    return [a.strip().lower() for a in ast.literal_eval(raw)]


def style_of(asp):
    for name, pat in STYLE_RULES:
        if any(re.search(pat, a) for a in asp):
            return name
    return None


def one_of(asp, rules):
    hits = {name for name, pat in rules if any(re.search(pat, a) for a in asp)}
    return hits.pop() if len(hits) == 1 else None


def labels(raw):
    asp = aspects(raw)
    return {"style": style_of(asp), "mood": one_of(asp, MOOD_RULES), "speed": one_of(asp, SPEED_RULES)}
