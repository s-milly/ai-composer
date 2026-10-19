// The band stage: one player per part (plus a drummer when there is a beat), each under a
// spotlight that brightens while that part is playing.
import { INST, PARTS, DRUM_PART } from "./catalog.js";

// Line icons drawn in a 100 x 100 box with currentColor; "b" marks a soft body fill.
const harpStrings = () => {
  let s = "";
  for (let x = 30; x <= 72; x += 6) {
    const top = 14 + (x - 24) * 0.3, bottom = 30 + (80 - x) * (58 / 44);
    s += `<line x1="${x}" y1="${top + 2}" x2="${x}" y2="${bottom - 2}" stroke-width="1.5"/>`;
  }
  return s;
};
const violinBody = `<path class="b" d="M50 30 C60 30 63 36 61 43 C60 47 57 49 59 52 C66 55 67 72 60 77 C55 81 45 81 40 77 C33 72 34 55 41 52 C43 49 40 47 39 43 C37 36 40 30 50 30 Z"/>
  <path d="M45 50 C43 54 47 58 45 62 M55 50 C57 54 53 58 55 62" stroke-width="2"/><path d="M50 30 V6"/><path d="M47 6 C47 0 54 0 53 5"/><path d="M50 64 V80" stroke-width="1.5"/>`;
const guitarBody = `<path class="b" d="M50 30 C62 30 66 38 64 46 C63 50 61 52 63 55 C72 58 72 82 50 84 C28 82 28 58 37 55 C39 52 37 50 36 46 C34 38 38 30 50 30 Z"/>`;
const eguitarBody = `<path class="b" d="M39 52 C31 47 28 33 34 31 C39 30 42 41 50 42 C57 42 58 28 64 28 C71 29 69 44 62 52 C73 60 71 84 52 88 C32 90 26 64 39 52 Z"/>
  <rect x="44" y="56" width="12" height="4" rx="1" fill="currentColor" stroke="none"/><rect x="44" y="66" width="12" height="4" rx="1" fill="currentColor" stroke="none"/><path d="M45 78 H55" stroke-width="2.5"/>`;
const keyboard = (y, h) => {
  let s = `<rect class="b" x="8" y="${y}" width="84" height="${h}" rx="3"/>`;
  for (let x = 15; x < 92; x += 7) s += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + h}" stroke-width="1.5"/>`;
  for (const x of [12.5, 19.5, 33.5, 40.5, 47.5, 61.5, 68.5, 82.5]) s += `<rect x="${x}" y="${y}" width="4" height="${h * 0.58}" fill="currentColor" stroke="none"/>`;
  return s;
};
export const ICONS = {
  piano: `<path class="b" d="M8 44 H66 C86 44 94 52 94 60 V64 H8 Z"/><path d="M14 44 L56 14 L74 44"/><path d="M14 64 V88 M86 64 V88 M48 64 V84"/><path d="M42 84 H54"/><rect x="4" y="46" width="16" height="8" rx="1"/>`,
  keys: `${keyboard(40, 18)}<path d="M22 58 L78 92 M78 58 L22 92"/>`,
  synth: `${keyboard(56, 20)}<rect class="b" x="8" y="34" width="84" height="22" rx="3"/><rect x="14" y="40" width="20" height="10" rx="1.5"/><circle cx="46" cy="45" r="4"/><circle cx="60" cy="45" r="4"/><circle cx="74" cy="45" r="4"/><path d="M84 40 V50"/>`,
  organ: `${[14, 23, 32, 41, 50, 59, 68, 77, 86].map((x, i) => { const h = 12 + Math.abs(4 - i) * -2.5 + 22; return `<rect x="${x - 3}" y="${56 - h}" width="6" height="${h}" rx="3"/>`; }).join("")}<rect class="b" x="8" y="56" width="84" height="28" rx="2"/><path d="M14 66 H86 M14 72 H86" stroke-width="2"/>`,
  accordion: `<rect class="b" x="8" y="28" width="18" height="50" rx="3"/><rect class="b" x="74" y="28" width="18" height="50" rx="3"/><path d="M26 30 L33 40 L26 50 L33 60 L26 70 L33 76 M40 30 L33 40 L40 50 L33 60 L40 70 L33 76 M40 30 L47 40 L40 50 L47 60 L40 70 L47 76 M54 30 L47 40 L54 50 L47 60 L54 70 L47 76 M54 30 L61 40 L54 50 L61 60 L54 70 L61 76 M68 30 L61 40 L68 50 L61 60 L68 70 L61 76 M68 30 L74 40 L68 50 L74 60 L68 70 L74 76" stroke-width="2"/><circle cx="14" cy="38" r="1.8" fill="currentColor"/><circle cx="20" cy="46" r="1.8" fill="currentColor"/><circle cx="14" cy="54" r="1.8" fill="currentColor"/><circle cx="20" cy="62" r="1.8" fill="currentColor"/>`,
  musicbox: `<rect class="b" x="16" y="48" width="64" height="34" rx="3"/><path d="M16 48 L26 20 H86 L80 48"/><rect x="26" y="56" width="34" height="10" rx="5"/><path d="M30 56 V66 M36 56 V66 M42 56 V66 M48 56 V66 M54 56 V66" stroke-width="1.5"/><path d="M80 62 H90 V52 H95"/>`,
  mallets: `${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<rect class="b" x="${10 + i * 10.5}" y="${46 - (22 - i * 2) / 2 + 8}" width="7.5" height="${30 - i * 2.5}" rx="1.5"/>`).join("")}<path d="M8 74 L94 70 M10 84 L18 74 M90 84 L84 72"/><path d="M28 34 L48 12 M72 34 L56 12"/><circle cx="48" cy="11" r="4" fill="currentColor"/><circle cx="56" cy="11" r="4" fill="currentColor"/>`,
  steelpan: `<ellipse class="b" cx="50" cy="52" rx="40" ry="26"/><ellipse cx="50" cy="52" rx="10" ry="6"/><ellipse cx="30" cy="48" rx="8" ry="5"/><ellipse cx="70" cy="48" rx="8" ry="5"/><ellipse cx="38" cy="64" rx="7" ry="4.5"/><ellipse cx="62" cy="64" rx="7" ry="4.5"/><path d="M14 52 V84 M86 52 V84"/><path d="M36 22 L52 36 M66 20 L56 36"/>`,
  guitar: `<g transform="rotate(-38 50 50)">${guitarBody}<circle cx="50" cy="58" r="6"/><path d="M42 74 H58"/><rect x="47" y="4" width="6" height="26" fill="currentColor" stroke="none"/><rect x="44.5" y="-6" width="11" height="11" rx="2"/></g>`,
  eguitar: `<g transform="rotate(-38 50 50)">${eguitarBody}<rect x="47.5" y="0" width="5" height="44" fill="currentColor" stroke="none"/><path d="M47 0 V-12 C47 -15 55 -15 55 -10 L53 0 Z" fill="currentColor" stroke-width="2"/></g>`,
  ebass: `<g transform="rotate(-38 50 52) translate(0 6)">${eguitarBody}<rect x="47.5" y="-10" width="5" height="54" fill="currentColor" stroke="none"/><path d="M45 -10 V-18 H55 V-10" stroke-width="2.5"/><path d="M45 -16 H41 M45 -12 H41 M55 -16 H59 M55 -12 H59" stroke-width="2"/></g>`,
  banjo: `<g transform="rotate(-38 50 50)"><circle class="b" cx="50" cy="64" r="21"/><circle cx="50" cy="64" r="15" stroke-width="2"/><rect x="47" y="4" width="6" height="40" fill="currentColor" stroke="none"/><rect x="45" y="-5" width="10" height="10" rx="2"/><path d="M44 74 H56"/></g>`,
  harp: `<path class="b" d="M24 88 V16 C40 6 64 18 80 30 L36 88 Z" stroke="none"/><path d="M24 88 V14 M24 14 C44 6 70 22 80 30 M80 30 L36 88 M18 88 H46"/>${harpStrings()}`,
  violin: `<g transform="rotate(-24 50 50) translate(0 6)">${violinBody}</g><path d="M14 30 L88 70" stroke-width="2"/>`,
  cello: `<g transform="translate(-2 -2) scale(1.08)">${violinBody}<path d="M50 80 V96" stroke-width="2.5"/></g><path d="M18 64 L86 52" stroke-width="2"/>`,
  strings: `<g transform="translate(23 5)"><g transform="translate(-22 14) rotate(-20 50 50) scale(0.72)">${violinBody}</g><g transform="translate(16 -2) rotate(-20 50 50) scale(0.72)">${violinBody}</g><g transform="translate(-4 22) rotate(-20 50 50) scale(0.72)">${violinBody}</g></g>`,
  flute: `<g transform="rotate(-24 50 50)"><rect class="b" x="4" y="46" width="92" height="8" rx="4"/><ellipse cx="18" cy="50" rx="2.5" ry="2" fill="currentColor"/>${[34, 42, 50, 62, 70, 78].map(x => `<circle cx="${x}" cy="50" r="2.4"/>`).join("")}</g>`,
  clarinet: `<path class="b" d="M46 12 H54 V76 L60 92 H40 L46 76 Z"/><path d="M47 4 H53 L54 12 H46 Z" fill="currentColor"/>${[26, 34, 42, 54, 62].map(y => `<circle cx="50" cy="${y}" r="2.4"/>`).join("")}`,
  bassoon: `<g transform="translate(12 0)"><rect class="b" x="42" y="10" width="14" height="80" rx="5"/><path d="M42 30 C32 30 28 38 24 44 L20 44"/><path d="M48 18 V82" stroke-width="1.5"/>${[40, 50, 60, 70].map(y => `<circle cx="52" cy="${y}" r="2.2"/>`).join("")}</g>`,
  sax: `<path d="M44 16 C46 32 46 52 46 66 C46 84 60 90 68 80 C73 74 73 64 72 56" stroke-width="11"/><path class="b" d="M64 58 L82 50 L86 60 L70 64 Z"/><path d="M44 16 C42 8 34 6 28 10" stroke-width="4"/>${[30, 40, 50, 60].map(y => `<circle cx="46" cy="${y}" r="2.6" fill="var(--stage-bg, #10141c)" stroke="none"/>`).join("")}`,
  trumpet: `<path class="b" d="M62 42 L92 28 V64 L62 50 Z"/><rect class="b" x="12" y="42" width="52" height="8" rx="3"/><path d="M6 44 V48 M6 46 H12"/><rect x="32" y="26" width="5" height="16" rx="1"/><rect x="40" y="26" width="5" height="16" rx="1"/><rect x="48" y="26" width="5" height="16" rx="1"/><path d="M24 50 C24 66 58 66 58 50"/>`,
  horn: `<circle cx="46" cy="50" r="26" stroke-width="6"/><circle cx="46" cy="50" r="14" stroke-width="3"/><path class="b" d="M62 68 L86 90 L94 76 L70 60 Z"/><path d="M26 30 L14 18"/><rect x="40" y="46" width="12" height="8" rx="1" fill="currentColor"/>`,
  trombone: `<path class="b" d="M58 36 L94 22 V54 L58 44 Z"/><path d="M8 52 H86 M8 62 H86 M8 52 C2 52 2 62 8 62" stroke-width="4"/><path d="M58 40 H34 V52" stroke-width="4"/><path d="M30 40 H22" stroke-width="3"/>`,
  tuba: `<path class="b" d="M28 10 H76 L66 28 H38 Z"/><rect class="b" x="32" y="28" width="40" height="54" rx="18"/><rect x="56" y="44" width="5" height="16" rx="1" fill="currentColor"/><rect x="64" y="44" width="5" height="16" rx="1" fill="currentColor"/><path d="M32 60 C20 60 16 50 18 42 L10 38"/>`,
  harmonica: `<rect class="b" x="10" y="36" width="80" height="28" rx="5"/><path d="M10 44 H90 M10 56 H90" stroke-width="2"/>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => `<rect x="${15 + i * 7.4}" y="47" width="4" height="6" rx="1" fill="currentColor" stroke="none"/>`).join("")}`,
  timpani: `<path class="b" d="M12 42 H88 C88 70 72 84 50 84 C28 84 12 70 12 42 Z"/><ellipse cx="50" cy="42" rx="38" ry="8"/><path d="M24 78 L18 94 M76 78 L82 94 M50 84 V94"/><path d="M30 30 L52 8 M70 30 L48 8"/><circle cx="52" cy="7" r="4" fill="currentColor"/><circle cx="48" cy="7" r="4" fill="currentColor"/>`,
  drums: `<circle class="b" cx="50" cy="68" r="22"/><circle cx="50" cy="68" r="8" stroke-width="2"/><ellipse class="b" cx="18" cy="56" rx="14" ry="5"/><path d="M6 56 V68 C6 72 30 72 30 68 V56"/><ellipse class="b" cx="84" cy="62" rx="12" ry="5"/><path d="M72 62 V80 C72 84 96 84 96 80 V62"/><ellipse cx="38" cy="36" rx="10" ry="4"/><ellipse cx="62" cy="36" rx="10" ry="4"/><path d="M38 40 V46 M62 40 V46"/><path d="M4 22 L30 18 M17 20 V50 M70 14 L98 18 M84 16 V56" stroke-width="2.5"/>`,
};

const ICON_LIST = Object.keys(ICONS);
const iconFor = id => (id === "drums" ? "drums" : INST[id] ? INST[id].icon : null);

let svg = null, onPick = () => {}, layoutKey = "";

export function mountStage(el, pick) {
  svg = el; onPick = pick;
  svg.addEventListener("click", e => { const g = e.target.closest("[data-part]"); if (g) onPick(+g.dataset.part); });
  svg.addEventListener("keydown", e => { const g = e.target.closest("[data-part]"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onPick(+g.dataset.part); } });
}

// band: four instrument ids (or "off"); drums: true when there is a drummer. only: the song is for
// just the instruments asked for, so empty chairs are left out and an instrument that plays several
// parts (a solo piano plays the tune, the chords and the bass) stands on stage once.
export function setBand(band, drums, only = false) {
  if (!svg) return;
  // on a phone the stage is drawn narrower, so the players come out bigger
  const narrow = svg.clientWidth > 0 && svg.clientWidth < 600;
  const W = narrow ? 620 : 1000, H = 440;
  let players = band.map((id, v) => ({ v, id, part: PARTS[v], parts: [v] }));
  if (only) {
    const seen = new Map();
    players = players.filter(pl => {
      if (!INST[pl.id]) return false;
      if (seen.has(pl.id)) { seen.get(pl.id).parts.push(pl.v); return false; }
      seen.set(pl.id, pl); return true;
    });
    for (const pl of players) {
      const name = players.length === 1 && !drums ? "Solo" : pl.parts.length === 1 ? pl.part.name : pl.parts.includes(0) ? "Melody and chords" : "Chords and bass";
      pl.part = { name, color: pl.part.color };
    }
  }
  if (drums) players.splice(Math.min(2, players.length), 0, { v: 4, id: "drums", part: DRUM_PART, parts: [4] });
  const side = narrow ? 30 : 110, n = players.length, xs = players.map((_, i) => side + (i + 0.5) * ((W - 2 * side) / n));
  const spread = narrow ? 58 : 92, top = narrow ? 120 : 10;  // a phone shows less empty wall above the lamps
  const key = JSON.stringify([band, drums, narrow, only]);
  if (key === layoutKey) return;
  layoutKey = key;
  let out = `<defs>
    <linearGradient id="st-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#161B26"/><stop offset="1" stop-color="#0B0E14"/></linearGradient>
    <linearGradient id="st-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1B202B"/><stop offset="1" stop-color="#252B38"/></linearGradient>
    <linearGradient id="st-beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF1D2" stop-opacity=".9"/><stop offset="1" stop-color="#FFE3A8" stop-opacity=".25"/></linearGradient>
    <radialGradient id="st-pool"><stop offset="0" stop-color="#FFE7B5" stop-opacity=".9"/><stop offset=".6" stop-color="#FFD98C" stop-opacity=".25"/><stop offset="1" stop-color="#FFD98C" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#st-wall)"/>
  ${Array.from({ length: Math.ceil(W / 72) }, (_, i) => `<rect x="${i * 72}" y="0" width="36" height="300" fill="#FFFFFF" opacity=".018"/>`).join("")}
  <path d="M0 300 H${W} L${W} ${H + 26} H0 Z" fill="url(#st-floor)"/>
  <path d="M0 300 H${W}" stroke="#2F3746" stroke-width="2"/>
  <rect x="40" y="${top + 4}" width="${W - 80}" height="8" rx="4" fill="#232A36"/>`;
  players.forEach((pl, i) => {
    const x = xs[i], back = pl.v === 4, floor = back ? 336 : 384, size = (back ? 120 : 132) * (narrow ? 0.85 : 1);
    const icon = iconFor(pl.id), off = !icon;
    const label = off ? "Off" : pl.id === "drums" ? "Drum kit" : INST[pl.id].name;
    out += `<g class="spot${off ? " off" : ""}" data-part="${pl.v}" data-parts="${pl.parts.join(",")}" style="--lit:0" tabindex="0" role="button" aria-label="${pl.part.name}: ${label}. Change instrument">
      <rect class="lamp" x="${x - 13}" y="${top}" width="26" height="18" rx="4"/>
      <polygon class="beam" points="${x - 9},${top + 16} ${x + 9},${top + 16} ${x + spread},${floor} ${x - spread},${floor}" fill="url(#st-beam)"/>
      <ellipse class="pool" cx="${x}" cy="${floor}" rx="${spread + 8}" ry="22" fill="url(#st-pool)"/>
      <g class="player" transform="translate(${x - size / 2} ${floor - size - 6}) scale(${size / 100})">
        ${off ? `<path d="M30 70 H70 M38 70 L34 98 M62 70 L66 98 M34 70 V40 H66 V70" class="chair"/>` : `<g class="ico">${ICONS[icon]}</g>`}
      </g>
      <text class="pname" x="${x}" y="${floor + 40}" text-anchor="middle"><tspan class="pdot" fill="${pl.part.color}">●</tspan> ${pl.part.name}</text>
      <text class="iname" x="${x}" y="${floor + 40 + 20}" text-anchor="middle">${label}</text>
      <rect class="hit" x="${x - spread + 10}" y="40" width="${2 * spread - 20}" height="${floor + 30}" fill="transparent"/>
    </g>`;
  });
  svg.setAttribute("viewBox", narrow ? `0 ${top - 14} ${W} ${420 - (top - 14)}` : `0 0 ${W} ${H + 26}`);
  svg.innerHTML = out;
}

// levels: brightness 0..1 for the four parts, then the drums.
export function light(levels) {
  if (!svg) return;
  svg.querySelectorAll(".spot").forEach(g => {
    const l = levels ? Math.max(...g.dataset.parts.split(",").map(v => levels[+v] || 0)) : 0;
    g.style.setProperty("--lit", l.toFixed(3));
  });
}

export { ICON_LIST };
