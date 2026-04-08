module.exports = {
  content: [
    "./src/pages/Auth/**/*.{html,js}",
    "./src/pages/Users/**/*.{html,js}",
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
        inter: ["Arial Rounded MT Bold", "Arial Rounded MT", "Arial", "sans-serif"],
        headline: ["Arial Rounded MT Bold", "Arial Rounded MT", "Arial", "sans-serif"],
        body: ["Arial Rounded MT Bold", "Arial Rounded MT", "Arial", "sans-serif"],
        label: ["Arial Rounded MT Bold", "Arial Rounded MT", "Arial", "sans-serif"],
        display: ["Arial Rounded MT Bold", "Arial Rounded MT", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};
