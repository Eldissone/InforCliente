const { config } = require("../../../config");
const { CHANNELS, DELIVERY_STATUS } = require("../channels");

/**
 * Provider do canal WhatsApp. Sem credenciais de um fornecedor (Meta
 * WhatsApp Business API, Twilio, etc. — ver `config.notifications.whatsapp`)
 * este provider nunca contacta nenhuma API externa: só regista a intenção e
 * devolve `SKIPPED`. O contrato já contempla o envio de anexos (ex.: PDF do
 * comprovativo de pagamento), para que a integração futura seja apenas
 * "implementar a chamada HTTP ao fornecedor" dentro deste ficheiro.
 */
function isConfigured() {
  return Boolean(config.notifications.whatsapp.provider && config.notifications.whatsapp.apiToken);
}

async function send({ user, title, body, link, attachments }) {
  const phone = user?.whatsapp || user?.profile?.whatsapp || null;

  if (!phone) {
    return { channel: CHANNELS.WHATSAPP, status: DELIVERY_STATUS.SKIPPED, reason: "USER_HAS_NO_WHATSAPP_NUMBER" };
  }

  if (!isConfigured()) {
    return { channel: CHANNELS.WHATSAPP, status: DELIVERY_STATUS.SKIPPED, reason: "PROVIDER_NOT_CONFIGURED" };
  }

  // TODO: integrar fornecedor real (ex.: POST para a Graph API do WhatsApp
  // Business, ou Twilio) usando config.notifications.whatsapp. O `phone`
  // já vem validado; `attachments` traz o(s) URL(s) de documentos (ex.:
  // comprovativo de pagamento em PDF) a anexar/linkar na mensagem.
  console.warn(
    `[notifications:whatsapp] Envio não implementado para ${phone}: "${title}"`,
    { link, attachments: attachments?.length || 0 }
  );
  return { channel: CHANNELS.WHATSAPP, status: DELIVERY_STATUS.SKIPPED, reason: "NOT_IMPLEMENTED" };
}

module.exports = { send, isConfigured };
