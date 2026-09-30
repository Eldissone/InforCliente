module.exports = {
  content: [
    "./src/pages/auth/**/*.{html,js}",
    "./src/pages/Users/**/*.{html,js}",
    "./src/shared/**/*.{html,js}",
  ],
  theme: {
    extend: {
      borderRadius: {
        DEFAULT: "0.125rem",
        lg: "0.25rem",
        xl: "0.5rem",
        full: "0.75rem",
      },
      fontFamily: {
        nunito: ["Nunito", "system-ui", "sans-serif"],
        inter: ["Nunito", "system-ui", "sans-serif"],
        headline: ["Nunito", "system-ui", "sans-serif"],
        body: ["Nunito", "system-ui", "sans-serif"],
        label: ["Nunito", "system-ui", "sans-serif"],
        display: ["Nunito", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};
