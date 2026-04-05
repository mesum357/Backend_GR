/**
 * Sends a 6-digit OTP via WhatsApp (Meta Cloud API or Twilio) or logs in dev.
 *
 * Meta (pick one naming style):
 *   WHATSAPP_ACCESS_TOKEN or META_WHATSAPP_ACCESS_TOKEN
 *   WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_BUSINESS_PHONE_ID (digits from Meta app)
 *   WHATSAPP_OTP_TEMPLATE_NAME — approved template with one {{1}} body variable for the code
 * Twilio:
 *   TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM (e.g. whatsapp:+14155238886)
 *
 * If neither provider is configured, returns { ok: true, dev: true } (console log only).
 * Auth routes treat dev mode as failure when NODE_ENV=production unless
 * ALLOW_WHATSAPP_OTP_CONSOLE_FALLBACK=1.
 */

function digitsOnlyE164(phoneE164) {
  const s = String(phoneE164 || '').replace(/\s/g, '');
  return s.replace(/^\+/, '');
}

/**
 * @param {{ intent?: 'signup' | 'password_reset' }} [opts]
 */
async function sendWhatsappOtpMessage(phoneE164, code, opts = {}) {
  const intent = opts.intent === 'password_reset' ? 'password_reset' : 'signup';
  const toRaw = String(phoneE164 || '').replace(/\s/g, '');
  const toDigits = digitsOnlyE164(toRaw);
  const token =
    process.env.WHATSAPP_ACCESS_TOKEN ||
    process.env.META_WHATSAPP_ACCESS_TOKEN ||
    process.env.WHATSAPP_TOKEN ||
    '';
  const phoneNumberId =
    process.env.WHATSAPP_PHONE_NUMBER_ID ||
    process.env.WHATSAPP_BUSINESS_PHONE_ID ||
    process.env.META_WHATSAPP_PHONE_NUMBER_ID ||
    '';
  const templateName =
    intent === 'password_reset' && process.env.WHATSAPP_PASSWORD_RESET_TEMPLATE_NAME
      ? process.env.WHATSAPP_PASSWORD_RESET_TEMPLATE_NAME
      : process.env.WHATSAPP_OTP_TEMPLATE_NAME;
  const templateLang = process.env.WHATSAPP_OTP_TEMPLATE_LANG || 'en';

  if (token && phoneNumberId && templateName) {
    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      to: toDigits,
      type: 'template',
      template: {
        name: templateName,
        language: { code: templateLang },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: String(code) }],
          },
        ],
      },
    };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (data.error) {
        console.error('[WhatsApp] Meta API error payload:', JSON.stringify(data.error));
        return { ok: false, error: data.error };
      }
      if (!res.ok) {
        console.error('[WhatsApp] Meta API HTTP error:', res.status, JSON.stringify(data));
        return { ok: false, error: data };
      }
      if (!data.messages?.[0]?.id) {
        console.error('[WhatsApp] Meta API unexpected body (no message id):', JSON.stringify(data));
        return { ok: false, error: data };
      }
      return { ok: true, provider: 'meta' };
    } catch (e) {
      console.error('[WhatsApp] Meta request failed:', e);
      return { ok: false, error: String(e) };
    }
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const twToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (sid && twToken && from) {
    const auth = Buffer.from(`${sid}:${twToken}`).toString('base64');
    const params = new URLSearchParams();
    params.set('From', from.startsWith('whatsapp:') ? from : `whatsapp:${from}`);
    const twilioTo =
      toRaw.startsWith('whatsapp:') ? toRaw : `whatsapp:+${toDigits.replace(/^\+/, '')}`;
    params.set('To', twilioTo);
    const twilioBody =
      intent === 'password_reset'
        ? `Your GB Rides password reset code is: ${code}`
        : `Your GB Rides verification code is: ${code}`;
    params.set('Body', twilioBody);
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error('[WhatsApp] Twilio error:', res.status, JSON.stringify(data));
        return { ok: false, error: data };
      }
      return { ok: true, provider: 'twilio' };
    } catch (e) {
      console.error('[WhatsApp] Twilio request failed:', e);
      return { ok: false, error: String(e) };
    }
  }

  console.log(
    `[WhatsApp OTP dev] intent=${intent} to=+${toDigits} code=${code} — no Meta/Twilio env; message NOT sent to WhatsApp`
  );
  return { ok: true, dev: true, provider: 'console' };
}

module.exports = { sendWhatsappOtpMessage };
