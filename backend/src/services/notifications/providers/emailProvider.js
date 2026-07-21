const { config } = require("../../../config");
const { CHANNELS, DELIVERY_STATUS } = require("../channels");

function isConfigured() {
  const e = config.notifications.email;
  if (!e.fromAddress) return false;
  if (e.provider === "smtp") {
    return Boolean(e.smtpHost);
  }
  if (e.provider === "sendgrid") {
    return Boolean(e.apiKey);
  }
  return Boolean(e.provider && e.apiKey);
}

async function fetchAttachmentBuffer(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

async function sendViaSendGrid({ to, subject, text, html, attachments = [] }) {
  const apiKey = config.notifications.email.apiKey;
  const from = config.notifications.email.fromAddress;

  const sgAttachments = [];
  for (const att of attachments) {
    const buf = att.content || (att.url ? await fetchAttachmentBuffer(att.url) : null);
    if (!buf) continue;
    sgAttachments.push({
      content: buf.toString("base64"),
      filename: att.filename || "anexo.pdf",
      type: att.contentType || "application/pdf",
      disposition: "attachment",
    });
  }

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from },
      subject,
      content: [
        { type: "text/plain", value: text },
        ...(html ? [{ type: "text/html", value: html }] : []),
      ],
      attachments: sgAttachments.length ? sgAttachments : undefined,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`SendGrid ${res.status}: ${errText.slice(0, 200)}`);
  }
  return { channel: CHANNELS.EMAIL, status: DELIVERY_STATUS.SENT };
}

async function sendViaSmtp({ to, subject, text, html, attachments = [] }) {
  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch {
    return {
      channel: CHANNELS.EMAIL,
      status: DELIVERY_STATUS.SKIPPED,
      reason: "NODEMAILER_NOT_INSTALLED",
    };
  }

  const e = config.notifications.email;
  const transporter = nodemailer.createTransport({
    host: e.smtpHost,
    port: e.smtpPort || 587,
    secure: Number(e.smtpPort) === 465,
    auth: e.smtpUser ? { user: e.smtpUser, pass: e.smtpPass } : undefined,
  });

  const mailAttachments = [];
  for (const att of attachments) {
    const buf = att.content || (att.url ? await fetchAttachmentBuffer(att.url) : null);
    if (!buf) continue;
    mailAttachments.push({
      filename: att.filename || "anexo.pdf",
      content: buf,
      contentType: att.contentType || "application/pdf",
    });
  }

  await transporter.sendMail({
    from: e.fromAddress,
    to,
    subject,
    text,
    html: html || undefined,
    attachments: mailAttachments,
  });

  return { channel: CHANNELS.EMAIL, status: DELIVERY_STATUS.SENT };
}

async function send({ user, title, body, link, attachments }) {
  if (!user?.email) {
    return { channel: CHANNELS.EMAIL, status: DELIVERY_STATUS.SKIPPED, reason: "USER_HAS_NO_EMAIL" };
  }

  if (!isConfigured()) {
    return { channel: CHANNELS.EMAIL, status: DELIVERY_STATUS.SKIPPED, reason: "PROVIDER_NOT_CONFIGURED" };
  }

  const subject = title || "Info Gestor";
  const text = [body, link ? `\n\nVer: ${link}` : ""].filter(Boolean).join("");
  const html = link
    ? `<p>${(body || "").replace(/\n/g, "<br>")}</p><p><a href="${link}">Abrir documento</a></p>`
    : `<p>${(body || "").replace(/\n/g, "<br>")}</p>`;

  const attList = Array.isArray(attachments) ? attachments : [];

  try {
    const provider = config.notifications.email.provider;
    if (provider === "sendgrid") {
      return await sendViaSendGrid({ to: user.email, subject, text, html, attachments: attList });
    }
    if (provider === "smtp") {
      return await sendViaSmtp({ to: user.email, subject, text, html, attachments: attList });
    }
    return { channel: CHANNELS.EMAIL, status: DELIVERY_STATUS.SKIPPED, reason: "UNKNOWN_PROVIDER" };
  } catch (error) {
    console.error("[notifications:email]", error.message);
    return { channel: CHANNELS.EMAIL, status: DELIVERY_STATUS.FAILED, reason: error.message };
  }
}

module.exports = { send, isConfigured };
