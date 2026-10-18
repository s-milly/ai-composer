// Grouped horizontal bars on a 0 to 100% axis, with a hover tooltip on each bar.
// rows: [{label, <series key>: value}]; series: [[key, name, color]].
export function drawGrouped(svg, wrap, tip, rows, series) {
  const W0 = wrap.clientWidth, phone = W0 < 560;
  const labW = phone ? 0 : 230, barH = 12, gap = 3, groupGap = phone ? 30 : 22, top = 6, lead = phone ? 22 : 0;
  const plotW = W0 - labW - 54;
  const groupH = series.length * barH + (series.length - 1) * gap;
  const h = top + rows.length * (groupH + lead) + (rows.length - 1) * groupGap + 24;
  svg.setAttribute("viewBox", `0 0 ${W0} ${h}`); svg.setAttribute("height", h);
  const x = v => labW + v * plotW;
  let out = "";
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    out += `<line x1="${x(v)}" x2="${x(v)}" y1="${top}" y2="${h - 20}" stroke="var(--grid)"/>`;
    out += `<text x="${x(v)}" y="${h - 4}" text-anchor="middle" font-size="11.5" fill="var(--muted)">${v * 100}%</text>`;
  }
  rows.forEach((r, i) => {
    const y0 = top + i * (groupH + lead + groupGap);
    out += phone
      ? `<text x="0" y="${y0 + 13}" font-size="13" font-weight="600" fill="var(--ink)">${r.label}</text>`
      : `<text x="${labW - 14}" y="${y0 + groupH / 2 + 5}" text-anchor="end" font-size="13" font-weight="600" fill="var(--ink)">${r.label}</text>`;
    series.forEach(([k, , color], j) => {
      const y = y0 + lead + j * (barH + gap), v = r[k], wv = Math.max(1, x(v) - labW);
      if (v > 0.005) out += `<path class="bar" data-r="${i}" data-k="${k}" d="M${labW},${y} h${Math.max(0, wv - 4)} a4,4 0 0 1 4,4 v${barH - 8} a4,4 0 0 1 -4,4 h${-Math.max(0, wv - 4)} z" fill="${color}"/>`;
      out += `<text x="${x(v) + 6}" y="${y + barH - 2}" font-size="11.5" fill="var(--ink-2)">${(v * 100).toFixed(0)}%</text>`;
      out += `<rect class="hit" data-r="${i}" data-k="${k}" x="${labW}" y="${y - 1}" width="${plotW}" height="${barH + 2}" fill="transparent"/>`;
    });
  });
  svg.innerHTML = out;
  svg.onpointermove = e => {
    const el = e.target.closest("[data-k]");
    if (!el) { tip.classList.remove("on"); return; }
    const r = rows[+el.dataset.r], s = series.find(([k]) => k === el.dataset.k);
    tip.textContent = `${s[1]}: ${(r[s[0]] * 100).toFixed(1)}% (${r.label.toLowerCase()})`;
    const box = el.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    const barEl = svg.querySelector(`.bar[data-r="${el.dataset.r}"][data-k="${el.dataset.k}"]`);
    const right = barEl ? barEl.getBoundingClientRect().right : box.left;
    tip.style.left = Math.min(wr.width - 150, Math.max(150, right - wr.left)) + "px";
    tip.style.top = (box.top - wr.top) + "px";
    tip.classList.add("on");
  };
  svg.onpointerleave = () => tip.classList.remove("on");
}
