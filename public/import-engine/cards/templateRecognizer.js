(function attachCardRecognizer(root) {
  const RED_SUITS = new Set(["d", "h"]);
  const WEIGHTS = { rank: 0.55, suit: 0.35, color: 0.1 };

  function clamp(value) {
    return Math.min(1, Math.max(0, value));
  }

  function templateMatrix(rows) {
    return rows.map((row) => [...row].map((cell) => (cell === "#" ? 1 : 0)));
  }

  function regionRect(layout, sample) {
    const x = Math.max(0, Math.floor(layout.x * sample.width));
    const y = Math.max(0, Math.floor(layout.y * sample.height));
    const right = Math.min(sample.width, Math.ceil((layout.x + layout.width) * sample.width));
    const bottom = Math.min(sample.height, Math.ceil((layout.y + layout.height) * sample.height));
    return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
  }

  // Foreground = ink-coloured pixels on the light card face. Ink strength is how far the darkest channel is
  // from white, so black and saturated red glyphs both register while pale card shading does not.
  function extractGlyph(sample, rect, inkThreshold) {
    const mask = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    let redness = 0;
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        const offset = (y * sample.width + x) * 4;
        const red = sample.data[offset];
        const green = sample.data[offset + 1];
        const blue = sample.data[offset + 2];
        if ((255 - Math.min(red, green, blue)) / 255 < inkThreshold) continue;
        mask.push([x, y]);
        count += 1;
        redness += red - (green + blue) / 2;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return { mask, count, redness, box: count ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null };
  }

  // Area-weighted resample of the glyph's bounding box onto the template grid, so scale and offset do not matter.
  // `pad` assumes the tight box is missing up to one template cell on a side (a faint glyph tip that fell below
  // the ink threshold), which would otherwise stretch the whole glyph.
  function resample(glyph, width, height, pad = {}) {
    const cells = Array.from({ length: height }, () => new Array(width).fill(0));
    const { box, mask } = glyph;
    const covered = new Set(mask.map(([x, y]) => `${x},${y}`));
    const cellWidth = box.width / (width - (pad.left || 0) - (pad.right || 0));
    const cellHeight = box.height / (height - (pad.top || 0) - (pad.bottom || 0));
    const originX = box.x - (pad.left || 0) * cellWidth;
    const originY = box.y - (pad.top || 0) * cellHeight;
    for (let ty = 0; ty < height; ty += 1) {
      for (let tx = 0; tx < width; tx += 1) {
        const x0 = originX + tx * cellWidth;
        const x1 = x0 + cellWidth;
        const y0 = originY + ty * cellHeight;
        const y1 = y0 + cellHeight;
        let inside = 0;
        let area = 0;
        for (let y = Math.floor(y0); y < Math.ceil(y1); y += 1) {
          for (let x = Math.floor(x0); x < Math.ceil(x1); x += 1) {
            const weight = (Math.min(x + 1, x1) - Math.max(x, x0)) * (Math.min(y + 1, y1) - Math.max(y, y0));
            if (weight <= 0) continue;
            area += weight;
            if (covered.has(`${x},${y}`)) inside += weight;
          }
        }
        cells[ty][tx] = area > 0 ? inside / area : 0;
      }
    }
    return cells;
  }

  const PAD_VARIANTS = (() => {
    const axis = [[0, 0], [1, 0], [0, 1]];
    const variants = [];
    for (const [left, right] of axis) for (const [top, bottom] of axis) variants.push({ left, right, top, bottom });
    return variants;
  })();

  // Ink-normalised sum of absolute differences: 1 - SAD / union ink, so large blank areas cannot flatter a match.
  function similarity(sampleCells, templateCells) {
    let difference = 0;
    let union = 0;
    for (let y = 0; y < templateCells.length; y += 1) {
      for (let x = 0; x < templateCells[y].length; x += 1) {
        difference += Math.abs(sampleCells[y][x] - templateCells[y][x]);
        union += Math.max(sampleCells[y][x], templateCells[y][x]);
      }
    }
    return union > 0 ? clamp(1 - difference / union) : 0;
  }

  function createTemplateRecognizer(templateSet) {
    if (!templateSet?.rank?.glyphs || !templateSet?.suit?.glyphs || !templateSet.layout) {
      throw new Error("A card template set with rank, suit, and layout definitions is required.");
    }
    const inkThreshold = templateSet.thresholds?.ink ?? 0.4;
    const minForeground = templateSet.thresholds?.minForegroundPixels ?? 6;
    const ranks = Object.entries(templateSet.rank.glyphs).map(([rank, rows]) => [rank, templateMatrix(rows)]);
    const suits = Object.entries(templateSet.suit.glyphs).map(([suit, rows]) => [suit, templateMatrix(rows)]);

    function reject(sample, reason) {
      return { card: null, confidence: 0, candidates: [], evidence: { reason, region: sample.region ?? null } };
    }

    function recognizeCard(sample) {
      const rankGlyph = extractGlyph(sample, regionRect(templateSet.layout.rank, sample), inkThreshold);
      const suitGlyph = extractGlyph(sample, regionRect(templateSet.layout.suit, sample), inkThreshold);
      const half = Math.ceil(minForeground / 2);
      if (rankGlyph.count + suitGlyph.count < minForeground || rankGlyph.count < half || suitGlyph.count < half) {
        return reject(sample, "insufficient-foreground");
      }
      const rankFrames = PAD_VARIANTS.map((pad) => resample(rankGlyph, templateSet.rank.width, templateSet.rank.height, pad));
      const suitFrames = PAD_VARIANTS.map((pad) => resample(suitGlyph, templateSet.suit.width, templateSet.suit.height, pad));
      const colorFamily = (rankGlyph.redness + suitGlyph.redness) / (rankGlyph.count + suitGlyph.count) > 40 ? "red" : "black";
      const bestFit = (frames, cells) => Math.max(...frames.map((frame) => similarity(frame, cells)));
      const rankScores = Object.fromEntries(ranks.map(([rank, cells]) => [rank, bestFit(rankFrames, cells)]));
      const suitScores = Object.fromEntries(suits.map(([suit, cells]) => [suit, bestFit(suitFrames, cells)]));

      const candidates = [];
      for (const [rank] of ranks) {
        for (const [suit] of suits) {
          const colorScore = (RED_SUITS.has(suit) ? "red" : "black") === colorFamily ? 1 : 0;
          const score = WEIGHTS.rank * rankScores[rank] + WEIGHTS.suit * suitScores[suit] + WEIGHTS.color * colorScore;
          candidates.push({ card: `${rank}${suit}`, score: Math.round(score * 1e6) / 1e6, rank, suit });
        }
      }
      candidates.sort((a, b) => b.score - a.score);
      const [best, second] = candidates;
      const margin = Math.max(0, best.score - (second?.score ?? 0));
      return {
        card: best.card,
        confidence: clamp(best.score * 0.85 + Math.min(0.15, margin)),
        candidates: candidates.map(({ card, score }) => ({ card, score })),
        evidence: {
          rankScore: rankScores[best.rank],
          suitScore: suitScores[best.suit],
          colorFamily,
          region: sample.region ?? null,
        },
      };
    }

    return { adapterVersion: templateSet.adapterVersion, recognizeCard, recognizeCards: (samples) => (samples || []).map(recognizeCard) };
  }

  const api = Object.freeze({ createTemplateRecognizer });
  root.PokerCoachCardRecognizer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
