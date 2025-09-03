/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'dark': '#121212', // Name the color 'dark' or any name you prefer
      }
    }
  },
  variants: {
    extend: {
            backgroundColor: ['hover'],  // This is already set to enable hover states
      transform: ['hover', 'focus'],        // Now 'hover' and 'focus' states can apply to transform utilities
      translate: ['hover', 'focus'],
    },
  },
  plugins: [],
}
