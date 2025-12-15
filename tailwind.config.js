/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./public/**/*.{html,js}",
    "./public/frontend/**/*.{html,js}",
    "./public/backend/**/*.{html,js}",
  ],
  theme: {
    extend: {
      colors: {
        // CaneMap custom green colors
        'cane': {
          50: '#f7fee7',
          100: '#ecfcca',
          200: '#d8f999',
          300: '#bbf451',
          400: '#9ae600',
          500: '#7ccf00',
          600: '#5ea500',
          700: '#497d00',
          800: '#3c6300',
          900: '#35530e',
          950: '#192e03',
        }
      }
    },
  },
  plugins: [],
}
