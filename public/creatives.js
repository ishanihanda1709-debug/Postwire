// Downloadable LinkedIn graphics, drawn on a canvas. They contain only text the user already has
// (headline, one-line subtitle, publisher, the user's name): no photos, no invented figures.
const DISP = '"Sora", "Arial Black", sans-serif';
const SANS = '"Manrope", system-ui, sans-serif';
const INK = '#0E1630', PAPER = '#F3F5FA', WHITE = '#FFFFFF';

export const SIZES = {
  portrait: { w: 1080, h: 1350, label: 'Portrait 4:5', pad: 84, head: 98, foot: 140, sub: 38, src: 28 },
  square: { w: 1080, h: 1080, label: 'Square 1:1', pad: 72, head: 90, foot: 124, sub: 34, src: 26 },
  landscape: { w: 1200, h: 627, label: 'Landscape', pad: 56, head: 56, foot: 80, sub: 24, src: 20 },
};

export const TEMPLATES = [
  { id: 'ink', label: 'Midnight' },
  { id: 'accent', label: 'Colour block' },
  { id: 'paper', label: 'Clean paper' },
  { id: 'quote', label: 'Big quote' },
];

const lum = (hex) => { const n = parseInt(hex.slice(1), 16); const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
const onColor = (hex) => (lum(hex) > 0.35 ? INK : WHITE);

function wrapLines(x, text, maxW) {
  const lines = []; let line = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    const t = line ? `${line} ${w}` : w;
    if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

// Largest font size (down to `min`) at which the headline fits the box.
function fit(x, text, { maxW, maxH, max, min = 28, lh = 1.08 }) {
  for (let s = max; s >= min; s -= 2) {
    x.font = `700 ${s}px ${DISP}`;
    const lines = wrapLines(x, text, maxW);
    if (lines.length * s * lh <= maxH) return { size: s, lines, lh };
  }
  x.font = `700 ${min}px ${DISP}`;
  const lines = wrapLines(x, text, maxW);
  const room = Math.max(1, Math.floor(maxH / (min * lh)));
  if (lines.length > room) { lines.length = room; lines[room - 1] = lines[room - 1].replace(/\s*\S*$/, '') + '…'; }
  return { size: min, lines, lh };
}

function drawLines(x, f, left, top, color) {
  x.fillStyle = color; x.textBaseline = 'top'; x.font = `700 ${f.size}px ${DISP}`;
  f.lines.forEach((l, i) => x.fillText(l, left, top + i * f.size * f.lh));
  return top + f.lines.length * f.size * f.lh;
}

function footer(x, S, { bg, fg, source, author, label }) {
  const y = S.h - S.foot;
  if (bg) { x.fillStyle = bg; x.fillRect(0, y, S.w, S.foot); }
  x.fillStyle = fg; x.font = `700 ${S.src}px ${SANS}`; x.textBaseline = 'middle';
  x.fillText(`${label ? label + '  ·  ' : ''}SOURCE: ${source}`.toUpperCase().slice(0, 54), S.pad, y + S.foot / 2);
  if (author) { x.textAlign = 'right'; x.fillText(author, S.w - S.pad, y + S.foot / 2); x.textAlign = 'left'; }
}

function subline(x, S, text, left, top, maxW, color) {
  if (!text) return;
  x.fillStyle = color; x.textBaseline = 'top'; x.font = `500 ${S.sub}px ${SANS}`;
  wrapLines(x, text, maxW).slice(0, 2).forEach((l, i) => x.fillText(l, left, top + i * S.sub * 1.4));
}

export function drawCreative({ template, size = 'portrait', headline, subline: sub = '', source, author = '', accent = '#6D5BF6', label = '' }) {
  const S = SIZES[size], c = document.createElement('canvas'); c.width = S.w; c.height = S.h;
  const x = c.getContext('2d'); x.textAlign = 'left';
  const innerW = S.w - S.pad * 2;
  const subRoom = sub ? S.sub * 1.4 * 2 + S.pad * 0.3 : 0;
  const top = S.pad * 1.7, bottom = S.h - S.foot - S.pad;
  const accentInk = onColor(accent);

  if (template === 'ink') {
    x.fillStyle = INK; x.fillRect(0, 0, S.w, S.h);
    x.fillStyle = accent; x.fillRect(S.pad, S.pad, S.pad * 1.4, S.pad * 0.16);
    const f = fit(x, headline, { maxW: innerW, maxH: bottom - top - subRoom, max: S.head });
    const y = drawLines(x, f, S.pad, top, WHITE);
    subline(x, S, sub, S.pad, y + S.pad * 0.3, innerW, '#AAB6D8');
    footer(x, S, { bg: accent, fg: accentInk, source, author, label });
  } else if (template === 'accent') {
    x.fillStyle = accent; x.fillRect(0, 0, S.w, S.h);
    const f = fit(x, headline, { maxW: innerW, maxH: bottom - top - subRoom, max: S.head });
    const y = drawLines(x, f, S.pad, top, accentInk);
    subline(x, S, sub, S.pad, y + S.pad * 0.3, innerW, accentInk === INK ? 'rgba(14,22,48,.8)' : 'rgba(255,255,255,.88)');
    footer(x, S, { bg: INK, fg: WHITE, source, author, label });
  } else if (template === 'paper') {
    x.fillStyle = PAPER; x.fillRect(0, 0, S.w, S.h);
    x.fillStyle = accent; x.fillRect(0, 0, S.pad * 0.28, S.h);
    const left = S.pad * 1.1, w = S.w - left - S.pad;
    const f = fit(x, headline, { maxW: w, maxH: bottom - top - subRoom, max: S.head });
    const y = drawLines(x, f, left, top, INK);
    x.fillStyle = accent; x.fillRect(left, y + S.pad * 0.18, S.pad * 1.2, S.pad * 0.12);
    subline(x, S, sub, left, y + S.pad * 0.55, w, '#4A566F');
    footer(x, S, { fg: '#4A566F', source, author, label });
    x.fillStyle = '#D5DBE8'; x.fillRect(left, S.h - S.foot, w, 3);
  } else if (template === 'quote') {
    x.fillStyle = INK; x.fillRect(0, 0, S.w, S.h);
    const q = Math.round(S.head * 3.2);
    x.fillStyle = accent; x.font = `700 ${q}px ${DISP}`; x.textBaseline = 'top'; x.fillText('“', S.pad - 8, S.pad * 0.3 + q * 0.02);
    const t = S.pad + q * 0.62;
    const f = fit(x, headline, { maxW: innerW, maxH: S.h - S.foot - t - S.pad * 0.6 - subRoom, max: Math.round(S.head * 0.92) });
    const y = drawLines(x, f, S.pad, t, WHITE);
    subline(x, S, sub, S.pad, y + S.pad * 0.3, innerW, '#AAB6D8');
    x.fillStyle = accent; x.fillRect(S.pad, S.h - S.foot, innerW, 4);
    footer(x, S, { fg: WHITE, source, author, label });
  } else {
    throw new Error(`Unknown template: ${template}`);
  }
  return c;
}
