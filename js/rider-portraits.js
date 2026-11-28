// NYC Spin-off: EUC Thrills — © 2026 VibezZzCoder — MIT.
// The riders' portraits in the picker: EUC Thrills' own rider-chooser drawings, from the generated element data in
// js/euc/ui/riderPortraits.js. The picker imports this module (and through it the data) the first time it opens,
// never at start-up. Each drawing is built with createElementNS from the data, element for element; nothing is parsed.
// The three riders' own supplied marks are PNG pixels in the existing reviewed logo modules: decoded once (from the
// bytes, no URL), reduced to at most MARK_WIDTH pixels wide with the full-size pixels released, and painted on a small
// canvas laid exactly over the mark's rectangle, whole and centred at the artwork's own aspect, as the original's
// preserveAspectRatio="xMidYMid meet" draws it. The page loads no data: or blob: image. Portraits are decorative
// (aria-hidden): the rider's name stays the label. Participant rights: NOTICE-EUC-THRILLS.md / FORK_GUIDE.md.
const SVG = 'http://www.w3.org/2000/svg';
const MARK_WIDTH = 256;

export function createRiderPortraits({ load = () => import('./euc/ui/riderPortraits.js'), decode = decodePng,
  pixelRatio = () => globalThis.devicePixelRatio || 1 } = {}) {
  let data = null, loading = null;
  const marks = new Map(); // rider id -> reduced { source, width, height }, or null when that mark failed
  const decoding = new Map(); // rider id -> promise of its single decode
  const canvases = new Set(); // mark canvases currently built (released ones leave)
  const stats = { builds: 0, paints: 0, markFailures: 0 };

  function ready() {
    loading ??= load().then(module => { data = module; return true; }, error => {
      console.warn('Rider portraits are unavailable; the picker works without them.', error);
      return false;
    });
    return loading;
  }

  // A span.rider-portrait holding the drawing (and a canvas for a mark), or null before the data has arrived.
  function build(id) {
    const rows = data?.PORTRAITS?.[id];
    if (!rows) return null;
    const box = document.createElement('span');
    box.className = 'rider-portrait';
    box.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', data.PORTRAIT_VIEWBOX);
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('aria-hidden', 'true');
    const add = (parent, list) => {
      for (const [tag, attributes, children] of list) {
        if (tag === 'mark') continue; // painted on the canvas below, at the same place
        const node = document.createElementNS(SVG, tag);
        for (const name of Object.keys(attributes)) node.setAttribute(name, attributes[name]);
        parent.append(node);
        if (children) add(node, children);
      }
    };
    add(svg, rows);
    box.append(svg);
    const rect = data.MARKS?.[id];
    if (rect) {
      const [x, y, w, h] = data.PORTRAIT_VIEWBOX.split(' ').map(Number);
      const canvas = document.createElement('canvas');
      canvas.className = 'rider-portrait-mark';
      canvas.dataset.mark = id;
      canvas.width = canvas.height = 0;
      // Percentages of the 96-unit drawing, set through the style object (the page allows no style attributes).
      canvas.style.left = `${(rect.x - x) / w * 100}%`;
      canvas.style.top = `${(rect.y - y) / h * 100}%`;
      canvas.style.width = `${rect.width / w * 100}%`;
      canvas.style.height = `${rect.height / h * 100}%`;
      box.append(canvas);
      canvases.add(canvas);
      decodeMark(id).then(() => paint(canvas));
    }
    stats.builds++;
    return box;
  }

  // Forget a portrait the picker no longer shows (its canvas pixels go with it).
  function release(box) {
    for (const canvas of box?.querySelectorAll?.('canvas') ?? []) { canvases.delete(canvas); canvas.width = canvas.height = 0; }
  }

  function decodeMark(id) {
    if (!decoding.has(id)) decoding.set(id, (async () => {
      try {
        const image = await data.MARK_IMAGES[id]();
        marks.set(id, reduce(await decode(base64Bytes(image.base64))));
      } catch (error) {
        marks.set(id, null); stats.markFailures++;
        console.warn(`Rider mark unavailable: ${id}`, error);
      }
    })());
    return decoding.get(id);
  }

  // Paint one mark canvas at its laid-out device-pixel size; layout is read only here.
  function paint(canvas) {
    const mark = marks.get(canvas.dataset.mark);
    if (!mark || !canvas.isConnected || !canvases.has(canvas)) return;
    const box = canvas.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    const ratio = pixelRatio(), w = Math.max(1, Math.round(box.width * ratio)), h = Math.max(1, Math.round(box.height * ratio));
    if (canvas.width === w && canvas.height === h && canvas.dataset.painted === 'true') return;
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    const scale = Math.min(w / mark.width, h / mark.height), dw = mark.width * scale, dh = mark.height * scale;
    g.drawImage(mark.source, (w - dw) / 2, (h - dh) / 2, dw, dh);
    canvas.dataset.painted = 'true';
    stats.paints++;
  }

  function repaint() { for (const canvas of canvases) paint(canvas); }

  return {
    ready, build, release, repaint,
    get loaded() { return !!data; },
    get stats() {
      let markBytes = 0;
      for (const canvas of canvases) markBytes += canvas.width * canvas.height * 4;
      for (const mark of marks.values()) if (mark) markBytes += mark.width * mark.height * 4;
      return { ...stats, marks: [...marks.values()].filter(Boolean).length, canvases: canvases.size, markBytes };
    },
  };
}

export function base64Bytes(text) {
  const raw = atob(text), bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// PNG bytes to something drawImage takes: the browser's decoder from the bytes, or the generated PNG decoder when
// createImageBitmap is missing or refuses.
export async function decodePng(bytes) {
  if (typeof createImageBitmap === 'function' && typeof Blob === 'function') {
    try {
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() };
    } catch { /* the generated decoder below */ }
  }
  const { decodePng: decodeBytes } = await import('./euc/render/pngDecode.js');
  const { width, height, rgba } = decodeBytes(bytes);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height), 0, 0);
  return { source: canvas, width, height, release: () => { canvas.width = canvas.height = 0; } };
}

// Keep a copy at most MARK_WIDTH wide (halving steps keep the reduction smooth), then release the full size.
function reduce(decoded) {
  let { source, width, height } = decoded;
  if (width <= MARK_WIDTH) return { source, width, height };
  while (width > MARK_WIDTH) {
    const w = Math.max(MARK_WIDTH, Math.round(width / 2)), h = Math.max(1, Math.round(height * w / width));
    const step = document.createElement('canvas');
    step.width = w; step.height = h;
    const g = step.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(source, 0, 0, w, h);
    if (source !== decoded.source) source.width = source.height = 0;
    source = step; width = w; height = h;
  }
  decoded.release?.();
  return { source, width, height };
}
