const { config } = require("../../../config");
const { CHANNELS, DELIVERY_STATUS } = require("../channels");

/**
 * Provider do canal e-mail. Enquanto não existir um fornecedor configurado
 * (SendGrid, SES, SMTP, etc. — ver `config.notifications.email`), este
 * provider não faz nenhuma chamada externa: apenas regista a intenção e
 * devolve `SKIPPED`. O contrato (`send({ user, title, body, link, ... })`)
 * já é o definitivo, para que ligar um fornecedor real no futuro não exija
 * alterar quem dispara as notificações — só este ficheiro.
 */
function isConfigured() {
  return Boolean(config.notifications.email.provider && config.notifications.email.apiKey);
}

async function send({ user, title, body, link, attachments }) {
  if (!user?.email) {
    return { channel: CHANNELS.EMAIL, status: DELIVERY_STATUS.SKIPPED, reason: "USER_HAS_NO_EMAIL" };
  }

  if (!isConfigured()) {
    return { channel: CHANNELS.EMAIL, status: DELIVERY_STATUS.SKIPPED, reason: "PROVIDER_NOT_CONFIGURED" };
  }

  // TODO: integrar fornecedor real (SendGrid/SES/SMTP) usando
  // config.notifications.email. Estrutura já preparada: destinatário
  // (user.email), título, corpo, link de contexto e anexos (ex.: PDF do
  // comprovativo de pagamento).
  console.warn(
    `[notifications:email] Envio não implementado para ${user.email}: "${title}"`,
    { link, attachments: attachments?.length || 0 }
  );
  return { channel: CHANNELS.EMAIL, status: DELIVERY_STATUS.SKIPPED, reason: "NOT_IMPLEMENTED" };
}

module.exports = { send, isConfigured };
