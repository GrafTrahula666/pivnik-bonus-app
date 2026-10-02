// Owner notification channel for kiosk shifts. Plain text only (no parse_mode),
// so employee-typed names can never inject markup.
export class NotConfiguredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotConfiguredError';
  }
}

export function createTelegramNotifier({ botToken, chatId, fetchImpl = globalThis.fetch, timeoutMs = 20_000 }) {
  const configured = Boolean(botToken && chatId);
  const endpoint = (method) => `https://api.telegram.org/bot${botToken}/${method}`;

  async function call(method, body) {
    if (!configured) throw new NotConfiguredError('Telegram shift channel is not configured');
    const response = await fetchImpl(endpoint(method), {
      method: 'POST',
      ...(body instanceof FormData ? { body } : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const retryAfter = Number(payload?.parameters?.retry_after || 0);
      throw Object.assign(new Error(`Telegram ${method} failed: HTTP ${response.status}`), { retryAfterSeconds: retryAfter });
    }
    return payload.result;
  }

  async function sendMessage(text) {
    return call('sendMessage', { chat_id: chatId, text: String(text).slice(0, 4000), disable_web_page_preview: true });
  }

  // photos: [{ data: Buffer, contentType }]; Telegram albums hold 2..10 items.
  async function sendPhotos(photos, caption = '') {
    const list = photos.slice(0, 10);
    if (!list.length) return null;
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (list.length === 1) {
      form.append('photo', new Blob([list[0].data], { type: list[0].contentType }), 'photo.jpg');
      if (caption) form.append('caption', caption.slice(0, 1000));
      return call('sendPhoto', form);
    }
    const media = list.map((photo, index) => ({
      type: 'photo',
      media: `attach://p${index}`,
      ...(index === 0 && caption ? { caption: caption.slice(0, 1000) } : {})
    }));
    form.append('media', JSON.stringify(media));
    list.forEach((photo, index) => form.append(`p${index}`, new Blob([photo.data], { type: photo.contentType }), `p${index}.jpg`));
    return call('sendMediaGroup', form);
  }

  return { configured, sendMessage, sendPhotos };
}
