export function evotorConfig(env = process.env) {
  return { enabled: env.PIVNIK_POS_ENABLED === 'true', token: env.EVOTOR_API_TOKEN || '', storeId: env.EVOTOR_STORE_ID || '' };
}

export async function fetchEvotorPage({ token, storeId, cursor, until, fetchImpl = fetch }) {
  if (!token || !storeId) throw Object.assign(new Error('Касса не подключена.'), { code: 'not_configured' });
  const url = new URL(`https://api.evotor.ru/stores/${encodeURIComponent(storeId)}/documents`);
  if (cursor) url.searchParams.set('cursor', cursor);
  else { url.searchParams.set('type', 'SELL,PAYBACK'); url.searchParams.set('until', String(new Date(until).getTime())); }
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.evotor.v2+json', 'Content-Type': 'application/vnd.evotor.v2+json' }
    });
  } catch { throw Object.assign(new Error('Облако Эвотора недоступно.'), { code: 'network' }); }
  if (!response.ok) {
    const codes = { 400: 'invalid_cursor', 401: 'token_expired', 402: 'not_installed', 403: 'forbidden', 429: 'rate_limit' };
    throw Object.assign(new Error('Ошибка доступа к Облаку Эвотора.'), { code: codes[response.status] || 'api_error' });
  }
  let page;
  try {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 5 * 1024 * 1024) throw new Error();
    page = JSON.parse(new TextDecoder().decode(bytes));
  } catch { throw Object.assign(new Error('Некорректный ответ Облака Эвотора.'), { code: 'invalid_response' }); }
  if (!Array.isArray(page.items) || page.items.length > 1000
    || (page.paging?.next_cursor != null && typeof page.paging.next_cursor !== 'string')) {
    throw Object.assign(new Error('Некорректная страница документов.'), { code: 'invalid_response' });
  }
  return page;
}
