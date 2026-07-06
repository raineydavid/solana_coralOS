// Mirrors docs/stuk-pitch-deck.html's palette — same visual system across deck, CLI, and video.
export const theme = {
  bg: '#0a0e0f',
  panel: '#121a1c',
  panel2: '#0e1416',
  line: '#223033',
  ink: '#eef4f2',
  inkSoft: '#aebbb8',
  inkFaint: '#7d8b88',
  accent: '#34e39a', // settlement green — the "pay" moment
  accentDeep: '#16a06a',
  amber: '#f5b544', // the dispute / refund path
  red: '#ef5566',
  mono: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
  sans: "'Helvetica Neue', Inter, system-ui, sans-serif",
} as const;
