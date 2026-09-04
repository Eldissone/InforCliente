const dotenv = require("dotenv");

dotenv.config();

const WEAK_JWT_SECRETS = new Set([
  "change-me",
  "changeme",
  "secret",
  "jwtsecret",
  "jwt-secret",
  "jwt_secret",
  "your-secret",
  "your_jwt_secret",
  "password",
  "admin123",
  "dev",
  "development",
]);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

function requireJwtSecret() {
  const value = requireEnv("JWT_SECRET").trim();
  if (value.length < 16) {
    throw new Error("JWT_SECRET demasiado curto (mínimo 16 caracteres).");
  }
  if (WEAK_JWT_SECRETS.has(value.toLowerCase())) {
    throw new Error("JWT_SECRET inválido: substitua o valor de exemplo por uma string aleatória.");
  }
  return value;
}

const config = {
  port: process.env.PORT || 4000,
  jwtSecret: requireJwtSecret(),
  frontendOrigin: process.env.FRONTEND_ORIGIN || "*",
  // Canais de notificação externos — opcionais. Enquanto não configurados,
  // os respetivos providers ficam em modo "not configured" (no-op seguro).
  notifications: {
    email: {
      provider: process.env.EMAIL_PROVIDER || null, // "smtp" | "sendgrid"
      apiKey: process.env.EMAIL_PROVIDER_API_KEY || null,
      fromAddress: process.env.EMAIL_FROM_ADDRESS || null,
      smtpHost: process.env.SMTP_HOST || null,
      smtpPort: Number(process.env.SMTP_PORT || 587),
      smtpUser: process.env.SMTP_USER || null,
      smtpPass: process.env.SMTP_PASS || process.env.EMAIL_PROVIDER_API_KEY || null,
      documentArchiveEmail: process.env.DOCUMENT_ARCHIVE_EMAIL || null,
    },
    whatsapp: {
      provider: process.env.WHATSAPP_PROVIDER || null, // ex.: "meta_business" | "twilio"
      apiToken: process.env.WHATSAPP_API_TOKEN || null,
      fromPhoneId: process.env.WHATSAPP_FROM_PHONE_ID || null,
    },
  },
};

module.exports = { config };

