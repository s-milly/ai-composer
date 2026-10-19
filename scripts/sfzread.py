"""A small SFZ reader: which sample file plays a given note at a given velocity."""
import os, re

NOTE = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}


def keynum(v):
    v = v.strip().lower()
    if re.fullmatch(r"-?\d+", v):
        return int(v)
    m = re.fullmatch(r"([a-g])([#b]?)(-?\d)", v)
    return 12 * (int(m.group(3)) + 1) + NOTE[m.group(1)] + {"#": 1, "b": -1, "": 0}[m.group(2)]


def read(path, defines=None, base=None):
    """Text of an .sfz with #include expanded and #define applied. Includes are relative to the
    top-level file's folder, as in the SFZ spec."""
    defines = {} if defines is None else defines
    base = base or os.path.dirname(path)
    out = []
    for line in open(path, encoding="utf8", errors="ignore"):
        line = line.split("//")[0]
        m = re.match(r'\s*#define\s+(\$\w+)\s+(.*)', line)
        if m:
            defines[m.group(1)] = m.group(2).strip(); continue
        for k in sorted(defines, key=len, reverse=True):
            line = line.replace(k, defines[k])
        # an #include can sit anywhere on a line, between opcodes
        parts = re.split(r'#include\s+"([^"]+)"', line)
        if len(parts) > 1:
            for i, p in enumerate(parts):
                if i % 2 == 0:
                    out.append(p)
                else:
                    inc = os.path.join(base, p.replace("\\", "/"))
                    if os.path.exists(inc):
                        out.append(read(inc, defines, base))
            continue
        for k in sorted(defines, key=len, reverse=True):
            line = line.replace(k, defines[k])
        out.append(line)
    return "\n".join(out)


def regions(path, root=None):
    """Every <region> with its inherited opcodes."""
    text = read(path)
    root = root or os.path.dirname(path)
    levels = {"control": {}, "global": {}, "master": {}, "group": {}}
    order = ["control", "global", "master", "group"]
    out, cur = [], None
    tokens = re.split(r"(<\w+>)", text)
    for tok in tokens:
        h = re.fullmatch(r"<(\w+)>", tok)
        if h:
            name = h.group(1)
            if cur is not None:
                out.append(cur); cur = None
            if name == "region":
                cur = {}
                for lv in order:
                    cur.update(levels[lv])
                cur["_region"] = True
            elif name in levels:
                i = order.index(name)
                for lv in order[i:]:
                    levels[lv] = {}
                target = levels[name]
            continue
        # opcodes: key=value, values may contain spaces only for sample=
        for m in re.finditer(r"(\w+)=(.*?)(?=\s+\w+=|\s*$)", tok.strip(), re.S | re.M):
            k, v = m.group(1), m.group(2).strip()
            (cur if cur is not None else target)[k] = v
    if cur is not None:
        out.append(cur)
    res = []
    for r in out:
        if "sample" not in r:
            continue
        dp = r.get("default_path", "")
        r["file"] = os.path.normpath(os.path.join(root, (dp + r["sample"]).replace("\\", "/")))
        if "key" in r:
            r["lokey"] = r["hikey"] = r["pitch_keycenter"] = r["key"]
        res.append(r)
    return res


def pick(regs, note, vel=90):
    best = []
    for r in regs:
        if r.get("trigger", "attack") not in ("attack", "first", "legato") or r.get("trigger") == "release":
            continue
        if any(k.startswith("sw_") for k in r) and "sw_default" not in r and "sw_last" in r:
            pass
        try:
            lo, hi = keynum(r.get("lokey", "0")), keynum(r.get("hikey", "127"))
        except Exception:
            continue
        if not (lo <= note <= hi):
            continue
        if not (int(float(r.get("lovel", 0))) <= vel <= int(float(r.get("hivel", 127)))):
            continue
        best.append(r)
    if not best:
        return None
    # a region with its own velocity range is a played note (others are often resonance layers);
    # then the sample recorded closest to this pitch, then the first round robin
    best.sort(key=lambda r: ("lovel" not in r and "hivel" not in r, abs(keynum(r.get("pitch_keycenter", r.get("lokey", "60"))) - note),
                             float(r.get("lorand", 0)), int(r.get("seq_position", 1))))
    r = best[0]
    return r["file"], keynum(r.get("pitch_keycenter", r.get("lokey", "60")))
