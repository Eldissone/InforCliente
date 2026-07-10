const dotenv = require("dotenv");

dotenv.config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

const config = {
  port: process.env.PORT || 4000,
  jwtSecret: requireEnv("JWT_SECRET"),
  frontendOrigin: process.env.FRONTEND_ORIGIN || "*",
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  // Canais de notificação externos — opcionais. Enquanto não configurados,
  // os respetivos providers ficam em modo "not configured" (no-op seguro).
  notifications: {
    email: {
      provider: process.env.EMAIL_PROVIDER || null, // ex.: "sendgrid" | "ses" | "smtp"
      apiKey: process.env.EMAIL_PROVIDER_API_KEY || null,
      fromAddress: process.env.EMAIL_FROM_ADDRESS || null,
    },
    whatsapp: {
      provider: process.env.WHATSAPP_PROVIDER || null, // ex.: "meta_business" | "twilio"
      apiToken: process.env.WHATSAPP_API_TOKEN || null,
      fromPhoneId: process.env.WHATSAPP_FROM_PHONE_ID || null,
    },
  },
};

module.exports = { config };

