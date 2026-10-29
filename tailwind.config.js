/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/client/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans Arabic"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        num: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d4d8e1',
          300: '#aeb6c6',
          400: '#818da5',
          500: '#616e8a',
          600: '#4d5872',
          700: '#40485d',
          800: '#373d4e',
          900: '#1d2230',
          950: '#0f1320',
        },
        // Belt colours, used for badges only — never as the sole signal.
        belt: {
          white: '#f3f4f6',
          blue: '#1d4ed8',
          purple: '#6d28d9',
          brown: '#78350f',
          black: '#111827',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgb(15 19 32 / 0.06), 0 4px 16px -4px rgb(15 19 32 / 0.08)',
      },
    },
  },
  plugins: [],
};
