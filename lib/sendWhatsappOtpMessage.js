/**
 * Sends a 6-digit OTP via WhatsApp (Meta Cloud API or Twilio) or logs in dev.
 *
 * Meta: set WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_OTP_TEMPLATE_NAME
 *       Template must have one {{1}} body variable for the code (authentication category).
 * Twilio: set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM (e.g. whatsapp:+14155238886)
 */

async function sendWhatsappOtpMessage(phoneE164, code) {
  const to = String(phoneE164 || '').replace(/\s/g, '');
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const templateName = process.env.WHATSAPP_OTP_TEMPLATE_NAME;
  const templateLang = process.env.WHATSAPP_OTP_TEMPLATE_LANG || 'en';

  if (token && phoneNumberId && templateName) {
    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      to: to.replace(/^\+/, ''),
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
      if (!res.ok) {
        console.error('[WhatsApp] Meta API error:', res.status, JSON.stringify(data));
        return { ok: false, error: data };
      }
      return { ok: true };
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
    params.set('To', to.startsWith('whatsapp:') ? to : `whatsapp:${to}`);
    params.set('Body', `Your GB Rides verification code is: ${code}`);
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
      return { ok: true };
    } catch (e) {
      console.error('[WhatsApp] Twilio request failed:', e);
      return { ok: false, error: String(e) };
    }
  }

  console.log(`[WhatsApp OTP dev] to=${to} code=${code} (configure Meta or Twilio env to send for real)`);
  return { ok: true, dev: true };
}

module.exports = { sendWhatsappOtpMessage };
