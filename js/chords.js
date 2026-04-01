/**
 * chords.js - SVG chord diagrams + tooltip on hover/tap
 *
 * Chord data format:
 *   frets: [E,A,D,G,B,e] - 0=open, -1=muted, 1+=fret number
 *   baseFret: starting fret (1 = nut position)
 */
(function () {
  'use strict';

  // Chord definitions
  // Czech notation: H = international B, B = international Bb
  const CHORD_DB = {
    // === Major ===
    'C':      { frets: [0, 3, 2, 0, 1, 0], baseFret: 1 },
    'D':      { frets: [-1, -1, 0, 2, 3, 2], baseFret: 1 },
    'E':      { frets: [0, 2, 2, 1, 0, 0], baseFret: 1 },
    'F':      { frets: [1, 3, 3, 2, 1, 1], baseFret: 1, barres: [1] },
    'G':      { frets: [3, 2, 0, 0, 0, 3], baseFret: 1 },
    'A':      { frets: [-1, 0, 2, 2, 2, 0], baseFret: 1 },
    'H':      { frets: [-1, 2, 4, 4, 4, 2], baseFret: 1, barres: [2] },
    'B':      { frets: [-1, 1, 3, 3, 3, 1], baseFret: 1, barres: [1] },

    // === Minor ===
    'Ami':    { frets: [-1, 0, 2, 2, 1, 0], baseFret: 1 },
    'Am':     { frets: [-1, 0, 2, 2, 1, 0], baseFret: 1 },
    'Dmi':    { frets: [-1, -1, 0, 2, 3, 1], baseFret: 1 },
    'Dm':     { frets: [-1, -1, 0, 2, 3, 1], baseFret: 1 },
    'Emi':    { frets: [0, 2, 2, 0, 0, 0], baseFret: 1 },
    'Em':     { frets: [0, 2, 2, 0, 0, 0], baseFret: 1 },
    'Fmi':    { frets: [1, 3, 3, 1, 1, 1], baseFret: 1, barres: [1] },
    'F#mi':   { frets: [2, 4, 4, 2, 2, 2], baseFret: 1, barres: [2] },
    'F#m':    { frets: [2, 4, 4, 2, 2, 2], baseFret: 1, barres: [2] },
    'Gmi':    { frets: [3, 5, 5, 3, 3, 3], baseFret: 1, barres: [3] },
    'G#mi':   { frets: [4, 6, 6, 4, 4, 4], baseFret: 1, barres: [4] },
    'Hmi':    { frets: [-1, 2, 4, 4, 3, 2], baseFret: 1, barres: [2] },
    'Cmi':    { frets: [-1, 3, 5, 5, 4, 3], baseFret: 1, barres: [3] },
    'C#mi':   { frets: [-1, 4, 6, 6, 5, 4], baseFret: 1, barres: [4] },
    'C#m':    { frets: [-1, 4, 6, 6, 5, 4], baseFret: 1, barres: [4] },
    'D#mi':   { frets: [-1, 6, 8, 8, 7, 6], baseFret: 1, barres: [6] },

    // === 7th ===
    'C7':     { frets: [0, 3, 2, 3, 1, 0], baseFret: 1 },
    'D7':     { frets: [-1, -1, 0, 2, 1, 2], baseFret: 1 },
    'E7':     { frets: [0, 2, 0, 1, 0, 0], baseFret: 1 },
    'F7':     { frets: [1, 3, 1, 2, 1, 1], baseFret: 1, barres: [1] },
    'G7':     { frets: [3, 2, 0, 0, 0, 1], baseFret: 1 },
    'A7':     { frets: [-1, 0, 2, 0, 2, 0], baseFret: 1 },
    'H7':     { frets: [-1, 2, 1, 2, 0, 2], baseFret: 1 },
    'B7':     { frets: [-1, 1, 3, 1, 3, 1], baseFret: 1, barres: [1] },

    // === Minor 7th ===
    'Ami7':   { frets: [-1, 0, 2, 0, 1, 0], baseFret: 1 },
    'Emi7':   { frets: [0, 2, 0, 0, 0, 0], baseFret: 1 },
    'Dmi7':   { frets: [-1, -1, 0, 2, 1, 1], baseFret: 1 },
    'Gmi7':   { frets: [3, 5, 3, 3, 3, 3], baseFret: 1, barres: [3] },

    // === Maj7 ===
    'Cmaj7':  { frets: [0, 3, 2, 0, 0, 0], baseFret: 1 },
    'Fmaj7':  { frets: [-1, -1, 3, 2, 1, 0], baseFret: 1 },
    'Gmaj7':  { frets: [3, 2, 0, 0, 0, 2], baseFret: 1 },
    'Cmaj':   { frets: [0, 3, 2, 0, 0, 0], baseFret: 1 },

    // === Sus ===
    'Asus2':  { frets: [-1, 0, 2, 2, 0, 0], baseFret: 1 },
    'Asus4':  { frets: [-1, 0, 2, 2, 3, 0], baseFret: 1 },
    'Dsus2':  { frets: [-1, -1, 0, 2, 3, 0], baseFret: 1 },
    'Dsus4':  { frets: [-1, -1, 0, 2, 3, 3], baseFret: 1 },
    'Esus4':  { frets: [0, 2, 2, 2, 0, 0], baseFret: 1 },
    'Gsus4':  { frets: [3, 3, 0, 0, 1, 3], baseFret: 1 },

    // === Add ===
    'Cadd9':  { frets: [0, 3, 2, 0, 3, 0], baseFret: 1 },
    'Fadd9':  { frets: [-1, -1, 3, 2, 1, 3], baseFret: 1 },

    // === Dim ===
    'Cdim':   { frets: [-1, 3, 4, 2, 4, 2], baseFret: 1 },
    'C#dim':  { frets: [-1, 4, 5, 3, 5, 3], baseFret: 1 },
    'Fdim':   { frets: [-1, -1, 3, 1, 0, 1], baseFret: 1 },
    'F#dim':  { frets: [-1, -1, 4, 2, 1, 2], baseFret: 1 },
    'Gdim':   { frets: [-1, -1, 5, 3, 2, 3], baseFret: 1 },

    // === Augmented / Other ===
    'Ami6':   { frets: [-1, 0, 2, 2, 1, 2], baseFret: 1 },
    'F#':     { frets: [2, 4, 4, 3, 2, 2], baseFret: 1, barres: [2] },
    'F#6':    { frets: [-1, -1, 4, 3, 4, 2], baseFret: 1 },
    'F6':     { frets: [-1, -1, 3, 2, 3, 1], baseFret: 1 },
    'G6':     { frets: [3, 2, 0, 0, 0, 0], baseFret: 1 },
    'C#':     { frets: [-1, -1, 3, 1, 2, 1], baseFret: 1 },
    'Eb':     { frets: [-1, -1, 1, 3, 4, 3], baseFret: 1 },
    'Ab7':    { frets: [-1, -1, 1, 1, 1, 2], baseFret: 4 },
    'A2':     { frets: [-1, 0, 2, 2, 0, 0], baseFret: 1 },  // same as Asus2
  };

  /**
   * Render SVG chord diagram
   */
  function renderChordSVG(chordName) {
    const chord = CHORD_DB[chordName];
    if (!chord) return null;

    const { frets, baseFret, barres } = chord;
    const W = 80;
    const H = 100;
    const padTop = 18;
    const padLeft = 16;
    const padRight = 8;
    const stringSpacing = (W - padLeft - padRight) / 5;
    const fretSpacing = (H - padTop - 10) / 4;
    const dotRadius = 4;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;

    // Background
    svg += `<rect width="${W}" height="${H}" fill="#16213e" rx="4"/>`;

    // Nut or fret number
    if (baseFret === 1) {
      svg += `<line x1="${padLeft}" y1="${padTop}" x2="${padLeft + stringSpacing * 5}" y2="${padTop}" stroke="#e0e0e0" stroke-width="3"/>`;
    } else {
      svg += `<text x="4" y="${padTop + fretSpacing / 2 + 3}" fill="#8899aa" font-size="9" font-family="system-ui">${baseFret}</text>`;
      svg += `<line x1="${padLeft}" y1="${padTop}" x2="${padLeft + stringSpacing * 5}" y2="${padTop}" stroke="#556677" stroke-width="1"/>`;
    }

    // Fret lines
    for (let i = 1; i <= 4; i++) {
      const y = padTop + i * fretSpacing;
      svg += `<line x1="${padLeft}" y1="${y}" x2="${padLeft + stringSpacing * 5}" y2="${y}" stroke="#556677" stroke-width="1"/>`;
    }

    // String lines
    for (let i = 0; i < 6; i++) {
      const x = padLeft + i * stringSpacing;
      svg += `<line x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop + 4 * fretSpacing}" stroke="#556677" stroke-width="1"/>`;
    }

    // Barres
    if (barres && barres.length > 0) {
      barres.forEach(barreFret => {
        const adjustedFret = barreFret - (baseFret - 1);
        if (adjustedFret >= 1 && adjustedFret <= 4) {
          const y = padTop + (adjustedFret - 0.5) * fretSpacing;
          // Find leftmost and rightmost strings in barre
          let minStr = 5, maxStr = 0;
          for (let s = 0; s < 6; s++) {
            const f = frets[s] - (baseFret - 1);
            if (frets[s] === barreFret || (frets[s] >= barreFret && f === adjustedFret)) {
              if (s < minStr) minStr = s;
              if (s > maxStr) maxStr = s;
            }
          }
          if (minStr <= maxStr) {
            const x1 = padLeft + minStr * stringSpacing;
            const x2 = padLeft + maxStr * stringSpacing;
            svg += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#e67e22" stroke-width="6" stroke-linecap="round"/>`;
          }
        }
      });
    }

    // Dots and open/muted markers
    for (let i = 0; i < 6; i++) {
      const x = padLeft + i * stringSpacing;
      const f = frets[i];

      if (f === -1) {
        // Muted
        svg += `<text x="${x}" y="${padTop - 5}" fill="#e74c3c" font-size="10" font-family="system-ui" text-anchor="middle">✕</text>`;
      } else if (f === 0) {
        // Open
        svg += `<circle cx="${x}" cy="${padTop - 7}" r="3" fill="none" stroke="#27ae60" stroke-width="1.5"/>`;
      } else {
        // Fretted
        const adjustedFret = f - (baseFret - 1);
        if (adjustedFret >= 1 && adjustedFret <= 4) {
          const y = padTop + (adjustedFret - 0.5) * fretSpacing;
          const isBarre = barres && barres.includes(f);
          if (!isBarre) {
            svg += `<circle cx="${x}" cy="${y}" r="${dotRadius}" fill="#e67e22"/>`;
          }
        }
      }
    }

    svg += '</svg>';
    return svg;
  }

  // Tooltip management
  let activeTooltip = null;

  function showTooltip(chordEl) {
    hideTooltip();
    const chordName = chordEl.dataset.chord;
    if (!chordName) return;

    const svg = renderChordSVG(chordName);
    if (!svg) return;

    const tooltip = document.createElement('div');
    tooltip.className = 'chord-tooltip';
    tooltip.innerHTML = `<div class="chord-name">${chordName}</div>${svg}`;

    chordEl.style.position = 'relative';
    chordEl.appendChild(tooltip);
    activeTooltip = { el: tooltip, parent: chordEl };

    // Ensure tooltip is visible in viewport
    const rect = tooltip.getBoundingClientRect();
    if (rect.top < 0) {
      tooltip.style.bottom = 'auto';
      tooltip.style.top = 'calc(100% + 8px)';
      tooltip.querySelector('::after') // CSS handles arrow flip
    }
    if (rect.left < 0) {
      tooltip.style.left = '0';
      tooltip.style.transform = 'none';
    }
    if (rect.right > window.innerWidth) {
      tooltip.style.left = 'auto';
      tooltip.style.right = '0';
      tooltip.style.transform = 'none';
    }
  }

  function hideTooltip() {
    if (activeTooltip) {
      activeTooltip.el.remove();
      activeTooltip = null;
    }
  }

  // Bind chord interactions
  function bindChordEvents() {
    document.addEventListener('mouseover', (e) => {
      const chord = e.target.closest('.chord');
      if (chord) showTooltip(chord);
    });

    document.addEventListener('mouseout', (e) => {
      const chord = e.target.closest('.chord');
      if (chord) hideTooltip();
    });

    // Touch support
    document.addEventListener('touchstart', (e) => {
      const chord = e.target.closest('.chord');
      if (chord) {
        e.preventDefault();
        showTooltip(chord);
      } else {
        hideTooltip();
      }
    });
  }

  // Export for use
  window.ChordDiagrams = { renderChordSVG, CHORD_DB };

  // Init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindChordEvents);
  } else {
    bindChordEvents();
  }
})();
