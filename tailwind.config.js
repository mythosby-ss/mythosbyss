/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./views/**/*.ejs', './public/js/**/*.js'],
  // status pill colours are chosen in server code (routes/admin/index.js), so keep them all
  safelist: ['pill-blue', 'pill-green', 'pill-red', 'pill-amber', 'pill-gray', 'pill-purple'],
  theme: {
    extend: {
      colors: {
        ink: '#0d0d0d',
        gold: { DEFAULT: '#b07a2a', dark: '#8f6120', soft: '#f3e8d3' },
        lilac: { DEFAULT: '#a58fd0', soft: '#ece6f6', deep: '#5d4a8a' },
        paper: '#faf8f5',
        // Admin panel colours
        'adm-bg':   '#f1f2f7',
        'adm-side': '#1a1d2b',
        'adm-blue': '#4c5fc7',
        'adm-blue2':'#3a4fb5',
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Manrope', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};
