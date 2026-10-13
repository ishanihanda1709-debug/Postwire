// Downloadable LinkedIn creatives, drawn on a canvas. They only ever contain the headline,
// the one-line subtitle, the publisher name and (optionally) the author's name: no invented numbers or claims.
const DISP = '"Bricolage Grotesque", "Arial Black", sans-serif';
const SANS = '"DM Sans", system-ui, sans-serif';
const C = { cobalt: '#3b4bff', pink: '#ff5c9d', sun: '#ffd43b', mint: '#2ee6a6', ink: '#0b0b1e', white: '#ffffff', mist: '#dfe2ff' };

export const SIZES = {
  portrait: { w: 1080, h: 1350, label: 'Portrait 4:5', pad: 80, head: 100, foot: 150, sub: 38, src: 28 },
  square: { w: 1080, h: 1080, label: 'Square 1:1', pad: 72, head: 92, foot: 130, sub: 34, src: 26 },
  landscape: { w: 1200, h: 627, label: 'Landscape', pad: 56, head: 58, foot: 84, sub: 24, src: 20 },
};

export const TEMPLATES = [
  { id: 'cobalt', label: 'Cobalt', photo: false },
  { id: 'sun', label: 'Sunshine', photo: false },
  { id: 'night', label: 'Midnight quote', photo: false },
  { id: 'pink', label: 'Pink poster', photo: false },
  { id: 'photo-full', label: 'Photo overlay', photo: true },
  { id: 'photo-split', label: 'Photo + text', photo: true, not: ['landscape'] },
];

function wrapLines(x, text, maxW) {
  const lines = []; let line = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    const t = line ? `${line} ${w}` : w;
    if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

// Largest font size (down to `min`) at which the text fits the box.
function fit(x, text, { maxW, maxH, max, min = 28, weight = 800, family = DISP, lh = 1.06 }) {
  for (let s = max; s >= min; s -= 2) {
    x.font = `${weight} ${s}px ${family}`;
    const lines = wrapLines(x, text, maxW);
    if (lines.length * s * lh <= maxH) return { size: s, lines, lh };
  }
  x.font = `${weight} ${min}px ${family}`;
  const lines = wrapLines(x, text, maxW);
  const room = Math.max(1, Math.floor(maxH / (min * lh)));
  if (lines.length > room) { lines.length = room; lines[room - 1] = lines[room - 1].replace(/\s*\S*$/, '') + '…'; }
  return { size: min, lines, lh };
}

function drawLines(x, f, left, top, color) {
  x.fillStyle = color; x.textBaseline = 'top'; x.font = `800 ${f.size}px ${DISP}`;
  f.lines.forEach((l, i) => x.fillText(l, left, top + i * f.size * f.lh));
  return top + f.lines.length * f.size * f.lh;
}

function cover(x, img, rx, ry, rw, rh) {
  const r = Math.max(rw / img.width, rh / img.height), pw = img.width * r, ph = img.height * r;
  x.save(); x.beginPath(); x.rect(rx, ry, rw, rh); x.clip(); x.drawImage(img, rx + (rw - pw) / 2, ry + (rh - ph) / 2, pw, ph); x.restore();
}

function footer(x, S, { bg, fg, source, author, y = S.h - S.foot, h = S.foot }) {
  if (bg) { x.fillStyle = bg; x.fillRect(0, y, S.w, h); }
  x.fillStyle = fg; x.font = `700 ${S.src}px ${SANS}`; x.textBaseline = 'middle';
  x.fillText(`SOURCE: ${source}`.toUpperCase().slice(0, 44), S.pad, y + h / 2);
  if (author) { x.textAlign = 'right'; x.fillText(author, S.w - S.pad, y + h / 2); x.textAlign = 'left'; }
}

function subline(x, S, text, left, top, maxW, color) {
  if (!text) return;
  x.fillStyle = color; x.textBaseline = 'top'; x.font = `500 ${S.sub}px ${SANS}`;
  const lines = wrapLines(x, text, maxW).slice(0, 2);
  lines.forEach((l, i) => x.fillText(l, left, top + i * S.sub * 1.4));
}

export function drawCreative({ template, size = 'portrait', headline, subline: sub = '', source, author = '', photo = null, photoCredit = '' }) {
  const S = SIZES[size], c = document.createElement('canvas'); c.width = S.w; c.height = S.h;
  const x = c.getContext('2d'); x.textAlign = 'left';
  const innerW = S.w - S.pad * 2;
  const subRoom = sub ? S.sub * 1.4 * 2 + S.pad * 0.3 : 0;
  const textTop = S.pad * 2, textBottom = S.h - S.foot - S.pad;

  if (template === 'cobalt') {
    x.fillStyle = C.cobalt; x.fillRect(0, 0, S.w, S.h);
    x.fillStyle = C.sun; x.fillRect(S.pad, S.pad, S.pad * 1.5, S.pad * 0.2);
    const f = fit(x, headline, { maxW: innerW, maxH: textBottom - textTop - subRoom, max: S.head });
    const y = drawLines(x, f, S.pad, textTop, C.white);
    subline(x, S, sub, S.pad, y + S.pad * 0.3, innerW, C.mist);
    footer(x, S, { bg: C.sun, fg: C.ink, source, author });
  } else if (template === 'sun') {
    x.fillStyle = C.sun; x.fillRect(0, 0, S.w, S.h);
    x.fillStyle = C.pink; x.fillRect(0, 0, S.pad * 0.4, S.h - S.foot);
    const left = S.pad * 1.1, w = S.w - left - S.pad;
    const f = fit(x, headline, { maxW: w, maxH: textBottom - textTop - subRoom, max: S.head });
    const y = drawLines(x, f, left, textTop, C.ink);
    subline(x, S, sub, left, y + S.pad * 0.3, w, '#3b2f00');
    footer(x, S, { bg: C.ink, fg: C.white, source, author });
  } else if (template === 'night') {
    x.fillStyle = C.ink; x.fillRect(0, 0, S.w, S.h);
    const q = Math.round(S.head * 3.2);
    x.fillStyle = C.pink; x.font = `800 ${q}px ${DISP}`; x.textBaseline = 'top'; x.fillText('“', S.pad - 8, S.pad * 0.3 + q * 0.02);
    const top = S.pad + q * 0.62;
    const f = fit(x, headline, { maxW: innerW, maxH: S.h - S.foot - top - S.pad * 0.6 - subRoom, max: Math.round(S.head * 0.92) });
    const y = drawLines(x, f, S.pad, top, C.white);
    subline(x, S, sub, S.pad, y + S.pad * 0.3, innerW, '#a7a7d6');
    x.fillStyle = C.mint; x.fillRect(S.pad, S.h - S.foot, innerW, 4);
    footer(x, S, { fg: C.mint, source, author });
  } else if (template === 'pink') {
    x.fillStyle = C.pink; x.fillRect(0, 0, S.w, S.h);
    const bx = S.pad * 0.7, by = S.pad * 0.7, bw = S.w - bx * 2 - 16, bh = S.h - S.foot - by - S.pad * 0.5 - 16;
    x.fillStyle = C.ink; x.fillRect(bx + 16, by + 16, bw, bh);
    x.fillStyle = C.white; x.fillRect(bx, by, bw, bh);
    x.strokeStyle = C.ink; x.lineWidth = 6; x.strokeRect(bx, by, bw, bh);
    const ip = S.pad * 0.8, iw = bw - ip * 2;
    const f = fit(x, headline, { maxW: iw, maxH: bh - ip * 2 - subRoom, max: S.head });
    const y = drawLines(x, f, bx + ip, by + ip, C.ink);
    subline(x, S, sub, bx + ip, y + S.pad * 0.3, iw, '#444');
    footer(x, S, { bg: C.ink, fg: C.white, source, author });
  } else if (template === 'photo-full' && photo) {
    cover(x, photo, 0, 0, S.w, S.h);
    const g = x.createLinearGradient(0, S.h * 0.25, 0, S.h); g.addColorStop(0, 'rgba(11,11,30,0)'); g.addColorStop(0.7, 'rgba(11,11,30,.9)'); g.addColorStop(1, 'rgba(11,11,30,.96)');
    x.fillStyle = g; x.fillRect(0, 0, S.w, S.h);
    const room = S.h * 0.5 - subRoom;
    const f = fit(x, headline, { maxW: innerW, maxH: room, max: Math.round(S.head * 0.95) });
    const textH = f.lines.length * f.size * f.lh;
    const top = S.h - S.foot - S.pad * 0.5 - subRoom - textH;
    x.fillStyle = C.sun; x.fillRect(S.pad, top - S.pad * 0.45, S.pad * 1.3, S.pad * 0.16);
    const y = drawLines(x, f, S.pad, top, C.white);
    subline(x, S, sub, S.pad, y + S.pad * 0.25, innerW, C.mist);
    footer(x, S, { fg: C.white, source, author });
  } else if (template === 'photo-split' && photo) {
    x.fillStyle = C.cobalt; x.fillRect(0, 0, S.w, S.h);
    const ph = Math.round(S.h * 0.46);
    cover(x, photo, 0, 0, S.w, ph);
    x.fillStyle = C.ink; x.fillRect(0, ph - 6, S.w, 12);
    const top = ph + S.pad * 0.7, bottom = S.h - S.foot - S.pad * 0.4;
    const f = fit(x, headline, { maxW: innerW, maxH: bottom - top - subRoom, max: Math.round(S.head * 0.85) });
    const y = drawLines(x, f, S.pad, top, C.white);
    subline(x, S, sub, S.pad, y + S.pad * 0.25, innerW, C.mist);
    footer(x, S, { bg: C.sun, fg: C.ink, source, author });
  } else {
    throw new Error(`Unknown or unavailable template: ${template}`);
  }
  // Stock photos carry their credit on the image itself, small and right-aligned above the footer.
  if (photoCredit && (template === 'photo-full' || template === 'photo-split')) {
    x.font = `500 ${Math.round(S.src * 0.72)}px ${SANS}`; x.textAlign = 'right'; x.textBaseline = 'alphabetic';
    x.fillStyle = 'rgba(255,255,255,.78)';
    x.fillText(photoCredit.slice(0, 70), S.w - S.pad, S.h - S.foot - Math.round(S.pad * 0.2));
    x.textAlign = 'left';
  }
  return c;
}
