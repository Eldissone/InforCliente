const dotenv = require("dotenv");

dotenv.config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: requireEnv("JWT_SECRET"),
  frontendOrigin: process.env.FRONTEND_ORIGIN || "*",
};

module.exports = { config };

