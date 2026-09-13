/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "!./src/sand3d/**",
  ],
  theme: {
    extend: {
      colors: {
        'dark': '#121212',
      }
    }
  },
}
