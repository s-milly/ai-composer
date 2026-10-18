// Piano roll for a finished song: time left to right, pitch bottom to top, one color per part.
import { PARTS, INST, noteName } from "./catalog.js";

const PAD = { l: 44, r: 12, t: 22, b: 10 };

export function drawRoll(svg, scroll, song) {
  const steps = song ? song.steps : 128;
  // fit the whole song on wide screens; on a phone keep notes readable and scroll sideways
  const stepW = Math.max(scroll.clientWidth < 600 ? 9 : 1.6, (scroll.clientWidth - PAD.l - PAD.r - 2) / steps);
  const w = PAD.l + PAD.r + steps * stepW, h = svg.clientHeight || 300;
  svg.setAttribute("width", w); svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const all = song ? song.parts.flatMap(p => p.notes.map(n => n.p)) : [48, 72];
  const lo = Math.min(...all) - 2, hi = Math.max(...all) + 2;
  const rowH = (h - PAD.t - PAD.b) / (hi - lo + 1);
  const y = p => PAD.t + (hi - p) * rowH, x = s => PAD.l + s * stepW;
  let out = "";
  for (let p = lo; p <= hi; p++) if (p % 12 === 0) {
    out += `<rect x="${PAD.l}" y="${y(p)}" width="${steps * stepW}" height="${rowH}" fill="var(--grid-2)"/>`;
    out += `<text x="${PAD.l - 8}" y="${y(p) + rowH / 2 + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${noteName(p)}</text>`;
  }
  for (let s = 0; s <= steps; s += 4) {
    const bar = s % 16 === 0;
    out += `<line x1="${x(s)}" x2="${x(s)}" y1="${PAD.t}" y2="${h - PAD.b}" stroke="${bar ? "var(--axis)" : "var(--grid)"}"/>`;
    if (bar && s < steps) out += `<text x="${x(s) + 4}" y="${PAD.t - 8}" font-size="11" fill="var(--muted)">${s / 16 + 1}</text>`;
  }
  if (song) song.parts.forEach((part, v) => {
    const off = !INST[part.inst];
    part.notes.forEach((n, i) => {
      out += `<rect class="nt" data-v="${v}" data-i="${i}" x="${x(n.s) + 0.5}" y="${y(n.p) + 0.5}" width="${Math.max(2, n.l * stepW - 1.5)}" height="${Math.max(2, rowH - 1)}" rx="2" fill="${PARTS[v].color}" opacity="${off ? 0.15 : 1}"/>`;
    });
  });
  else out += `<text x="${PAD.l + 12}" y="${h / 2}" font-size="14" fill="var(--muted)">Describe a song and press Compose.</text>`;
  out += `<line class="ph" x1="0" x2="0" y1="${PAD.t - 4}" y2="${h - PAD.b}" stroke="var(--ink)" stroke-width="2" opacity="0"/>`;
  svg.innerHTML = out;
  svg._x = x; svg._steps = steps;
}

export function rollHead(svg, scroll, step) {
  const ph = svg.querySelector(".ph"); if (!ph) return;
  if (step == null) { ph.setAttribute("opacity", 0); return; }
  const px = svg._x(Math.min(step, svg._steps));
  ph.setAttribute("x1", px); ph.setAttribute("x2", px); ph.setAttribute("opacity", 1);
  if (px > scroll.scrollLeft + scroll.clientWidth - 40 || px < scroll.scrollLeft) scroll.scrollLeft = px - 60;
}

export function rollTip(e, song, tip, wrap) {
  const el = e.target.closest(".nt");
  if (!el || !song) { tip.classList.remove("on"); return; }
  const v = +el.dataset.v, n = song.parts[v].notes[+el.dataset.i], id = song.parts[v].inst;
  const beats = n.l / 4;
  tip.textContent = `${PARTS[v].name} (${INST[id] ? INST[id].name : "off"}) · ${noteName(n.p)} · bar ${Math.floor(n.s / 16) + 1} · ${beats} beat${beats === 1 ? "" : "s"}`;
  const box = el.getBoundingClientRect(), r = wrap.getBoundingClientRect();
  tip.style.left = Math.min(r.width - 120, Math.max(120, box.left + box.width / 2 - r.left)) + "px";
  tip.style.top = (box.top - r.top) + "px";
  tip.classList.add("on");
}
