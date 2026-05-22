import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Semantic tokens (map to CSS variables at runtime)
        'bg-base': 'var(--bg)',
        'bg-surface': 'var(--surface)',
        'bg-surface2': 'var(--surface2)',
        'bg-surface3': 'var(--surface3)',
        'border-subtle': 'var(--border)',
        'border-medium': 'var(--border2)',
        'text-primary': 'var(--text)',
        'text-mid': 'var(--text-mid)',
        'text-muted': 'var(--text-dim)',
        'accent-cyan': 'var(--cyan)',
        'accent-violet': 'var(--violet)',
        'accent-green': 'var(--emerald)',
        'accent-red': 'var(--rose)',
        'accent-amber': 'var(--amber)',
        // 6D Brand literal tokens
        navy: { DEFAULT: '#0A2A57', deep: '#06224A' },
        blue: { DEFAULT: '#2563AB', soft: '#DCE9F7' },
        orange: { DEFAULT: '#F47B20', deep: '#D9601A', soft: '#FCE4CC' },
        gold: '#FFB347',
        teal: '#2A9D8F',
        canvas: '#F7F9FC',
      },
      fontFamily: {
        ui: ['"Open Sans"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        sans: ['"Open Sans"', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 2px 6px rgba(15,25,50,0.05)',
        banner: '0 2px 8px rgba(6,34,74,0.3)',
        elevated: '0 12px 32px rgba(15,25,50,0.15)',
      },
      backgroundImage: {
        'banner-6d': 'linear-gradient(90deg, #06224A 0%, #0A2A57 35%, #2563AB 100%)',
        'warm-accent': 'linear-gradient(90deg, #FFB347, #F47B20)',
        'cool-accent': 'linear-gradient(90deg, #2563AB, #0A2A57)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-in': 'slideIn 0.2s ease-out',
        'dot-blink': 'dotBlink 1.5s ease infinite',
      },
      keyframes: {
        slideIn: {
          from: { opacity: '0', transform: 'translateY(-4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        dotBlink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.2' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
