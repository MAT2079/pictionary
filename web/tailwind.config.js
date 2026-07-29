/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Cohesive "late-night studio" palette: deep ink, electric violet accent,
      // mint secondary, coral for alerts, gold for scores. Used deliberately.
      colors: {
        ink: '#0b0b14',
        surface: '#15151f',
        'surface-2': '#1e1e2c',
        line: '#2a2a3c',
        violet: {
          DEFAULT: '#7c5cff',
          soft: '#9d86ff',
          deep: '#5a3ee0',
        },
        mint: '#3ee6c4',
        coral: '#ff5d73',
        gold: '#ffcf5c',
        muted: '#8a8aa3',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      // Intentional, slightly oversized type scale for projector legibility.
      fontSize: {
        mega: ['clamp(3rem, 9vw, 9rem)', { lineHeight: '0.95', letterSpacing: '-0.03em' }],
        huge: ['clamp(2rem, 5vw, 4.5rem)', { lineHeight: '1', letterSpacing: '-0.02em' }],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(124,92,255,0.4), 0 8px 40px -8px rgba(124,92,255,0.5)',
        card: '0 12px 40px -12px rgba(0,0,0,0.6)',
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '100%': { transform: 'scale(1.4)', opacity: '0' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.6s ease-out infinite',
        'fade-up': 'fade-up 0.4s ease-out',
      },
    },
  },
  plugins: [],
};
