/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
        },
      },
      animation: {
        "pulse-dot": "pulse-dot 2s ease-in-out infinite",
        "fade-up": "fadeUp .25s ease-out",
        "slide-in": "slideIn .3s ease-out",
      },
      keyframes: {
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: ".4" },
        },
        fadeUp: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        slideIn: {
          from: { opacity: "0", transform: "translateX(100%)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
      },
    },
  },
  plugins: [],
};
