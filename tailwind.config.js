/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/client/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Colours are CSS custom properties defined in src/client/index.css, so
      // light/dark swap in one place and the components name roles, not hex.
      colors: {
        surface: 'var(--surface-1)',
        raised: 'var(--surface-2)',
        plane: 'var(--plane)',
        ink: {
          DEFAULT: 'var(--ink-1)',
          soft: 'var(--ink-2)',
          muted: 'var(--ink-muted)',
        },
        hairline: 'var(--border)',
        grid: 'var(--grid)',
        axis: 'var(--axis)',
        series: {
          DEFAULT: 'var(--series-1)',
          wash: 'var(--series-1-wash)',
        },
        good: 'var(--good)',
        warning: 'var(--warning)',
        serious: 'var(--serious)',
        critical: 'var(--critical)',
      },
      fontFamily: {
        // System sans in both scripts: no webfont download, so the app opens
        // instantly on a phone and works with no network at all.
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Noto Sans Arabic',
          'Tahoma',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 1px 2px rgb(11 11 11 / 0.04), 0 2px 8px -2px rgb(11 11 11 / 0.06)',
        sheet: '0 -8px 32px -8px rgb(11 11 11 / 0.18)',
      },
      borderRadius: { xl2: '14px' },
      spacing: { safe: 'env(safe-area-inset-bottom, 0px)' },
    },
  },
  plugins: [],
};
