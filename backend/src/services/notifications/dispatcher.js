const { CHANNELS, DELIVERY_STATUS } = require("./channels");
const inAppProvider = require("./providers/inAppProvider");
const emailProvider = require("./providers/emailProvider");
const whatsappProvider = require("./providers/whatsappProvider");

const PROVIDERS = {
  [CHANNELS.IN_APP]: inAppProvider,
  [CHANNELS.EMAIL]: emailProvider,
  [CHANNELS.WHATSAPP]: whatsappProvider,
};

/**
 * Ponto único de disparo de notificações multi-canal.
 *
 * Quem dispara uma notificação de negócio (pagamento, menção, aprovação,
 * etc.) não precisa de saber como cada canal funciona nem se está ligado a
 * um fornecedor externo — só pede os canais desejados e este dispatcher
 * encaminha para o provider correspondente, devolvendo um resultado por
 * canal (`SENT` | `SKIPPED` | `FAILED` + motivo).
 *
 * Hoje só o canal `in_app` entrega de facto. `email` e `whatsapp` ficam
 * documentados como `SKIPPED` até existirem credenciais configuradas
 * (ver `config.notifications`), sem quebrar nem alterar o comportamento
 * dos fluxos que já usam apenas notificações in-app.
 *
 * @param {object} params
 * @param {import("socket.io").Server} [params.io] - instância Socket.IO (opcional)
 * @param {{id:string,email?:string,whatsapp?:string,profile?:object}} params.user - destinatário
 * @param {string} params.type - tipo de negócio da notificação (ex.: "PAYMENT", "NEW_MESSAGE")
 * @param {string} params.title
 * @param {string} [params.body]
 * @param {string} [params.link]
 * @param {object} [params.metadata]
 * @param {string[]} [params.channels] - canais desejados (default: apenas in_app)
 * @param {Array<{url:string,filename?:string}>} [params.attachments] - ex.: comprovativo em PDF
 */
async function dispatchNotification({
  io,
  user,
  type,
  title,
  body,
  link,
  metadata,
  channels = [CHANNELS.IN_APP],
  attachments,
} = {}) {
  if (!user?.id) return [];

  const results = [];
  for (const channel of channels) {
    const provider = PROVIDERS[channel];
    if (!provider) {
      results.push({ channel, status: DELIVERY_STATUS.SKIPPED, reason: "UNKNOWN_CHANNEL" });
      continue;
    }

    try {
      const result = await provider.send({ io, user, type, title, body, link, metadata, attachments });
      results.push(result);
    } catch (error) {
      console.error(`[notifications] provider "${channel}" falhou:`, error);
      results.push({ channel, status: DELIVERY_STATUS.FAILED, reason: error.message });
    }
  }

  return results;
}

/**
 * Resolve, para um utilizador, quais canais adicionais (além do in-app,
 * sempre incluído) fazem sentido pedir hoje — com base apenas nos dados que
 * já existem (número de WhatsApp preenchido no perfil). Não implica que o
 * canal vá entregar de facto; isso depende do provider estar configurado.
 */
function resolveEligibleChannels(user) {
  const channels = [CHANNELS.IN_APP];
  if (user?.whatsapp || user?.profile?.whatsapp) channels.push(CHANNELS.WHATSAPP);
  if (user?.email) channels.push(CHANNELS.EMAIL);
  return channels;
}

async function getProviderStatus() {
  return {
    [CHANNELS.IN_APP]: { configured: inAppProvider.isConfigured() },
    [CHANNELS.EMAIL]: { configured: emailProvider.isConfigured() },
    [CHANNELS.WHATSAPP]: { configured: whatsappProvider.isConfigured() },
  };
}

module.exports = {
  CHANNELS,
  DELIVERY_STATUS,
  dispatchNotification,
  resolveEligibleChannels,
  getProviderStatus,
};
