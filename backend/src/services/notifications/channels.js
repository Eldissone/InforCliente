/**
 * Canais de notificação suportados pelo sistema. Esta é a lista fechada de
 * identificadores válidos — qualquer novo canal (ex.: SMS, push nativo)
 * deve ser adicionado aqui e ganhar um provider correspondente em
 * `./providers/`.
 */
const CHANNELS = Object.freeze({
  IN_APP: "in_app",
  EMAIL: "email",
  WHATSAPP: "whatsapp",
});

/** Estados possíveis do resultado de um envio por canal. */
const DELIVERY_STATUS = Object.freeze({
  SENT: "SENT",
  SKIPPED: "SKIPPED",
  FAILED: "FAILED",
});

module.exports = { CHANNELS, DELIVERY_STATUS };
