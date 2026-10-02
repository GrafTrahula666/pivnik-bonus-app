/* A separate, ordinary client module. Reuses the application's session API. */
(() => {
  const mount = document.getElementById('posAdminMount');
  if (!mount) return;
  const preview = window.__PIVNIK_POS_PREVIEW__;
  const request = (path, options) => preview ? preview.request(path, options) : api(path, options);
  const canWrite = () => !preview && typeof state !== 'undefined' && state.profile?.role === 'admin';
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = (value) => {
    if (value == null) return '—';
    const cents = BigInt(value), absolute = cents < 0n ? -cents : cents;
    return (cents < 0n ? '−' : '') + (absolute / 100n).toLocaleString('ru-RU') + ',' + String(absolute % 100n).padStart(2,'0') + ' ₽';
  };
  const date = (value) => value ? new Date(value).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}) : 'ещё не выполнена';
  const quantity = (v) => { const n=BigInt(v), a=n<0n ? -n : n; return (n<0n ? '−':'')+String(a/1000n)+','+String(a%1000n).padStart(3,'0'); };
  let tab = 'app', data = null, serial = 0;
  mount.className = 'pos-dashboard';
  mount.innerHTML = `<h3>Продажи Пивника</h3><div class="pos-tabs" role="group" aria-label="Раздел аналитики">
    <button type="button" data-pos-tab="app" aria-pressed="true">Клиенты приложения</button>
    <button type="button" data-pos-tab="all" aria-pressed="false">Все продажи кассы</button></div>
    <div class="pos-controls"><label>Период <select id="posPeriod"><option value="today">Сегодня</option><option value="yesterday">Вчера</option><option value="7days">7 дней</option><option value="month">Месяц</option><option value="custom">Свой период</option></select></label>
    <label hidden id="posFromLabel">С <input id="posFrom" type="date"></label><label hidden id="posToLabel">По <input id="posTo" type="date"></label>
    <button type="button" id="posRefresh">Обновить</button><button type="button" id="posSync" hidden>Загрузить из кассы</button></div>
    <div class="pos-state" id="posConnection" role="status">Проверяем подключение…</div><p class="pos-note">Дни и часы — по Москве. Связанные покупки уже входят во все продажи кассы.</p>
    <div id="posResult"></div><div class="pos-link-form" id="posLinkForm" hidden><h4>Подтвердить клиента выбранного чека</h4>
    <p class="pos-note">Сверьте чек с покупателем и отсканируйте его QR Пивника. Сумма и время сами по себе не подтверждают личность.</p>
    <div class="pos-controls"><label>ID документа <input id="posDocument" readonly></label><label>QR клиента <input id="posQr" autocomplete="off" placeholder="PVK-… или данные QR"></label><button type="button" id="posConfirm">Подтвердить связь</button></div></div>`;
  const find = (id) => mount.querySelector('#'+id);
  function table(headers, rows) {
    return `<div class="pos-table-wrap"><table><thead><tr>${headers.map((s)=>`<th>${escape(s)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((cells)=>`<tr>${cells.map((s)=>`<td>${s}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">Данных за период нет</td></tr>`}</tbody></table></div>`;
  }
  function metric(label, value, note='') { return `<div class="pos-metric"><span>${escape(label)}</span><strong>${escape(value)}</strong><small>${escape(note)}</small></div>`; }
  function series(title, rows) {
    const maximum = rows.reduce((max,r)=> { const n=BigInt(r.amountCents); return n>max?n:max; },1n);
    return `<section><h4>${title}</h4><div class="pos-bars" aria-hidden="true">${rows.map((r)=>`<div class="pos-bar" title="${escape(r.label+' · '+money(r.amountCents))}" style="height:${BigInt(r.amountCents)>0n ? Number(BigInt(r.amountCents)*100n/maximum) : 1}%"></div>`).join('')}</div>${table(['Период','Итог'],rows.map((r)=>[escape(r.label),escape(money(r.amountCents))]))}</section>`;
  }
  function render() {
    if (!data) return;
    mount.querySelectorAll('[data-pos-tab]').forEach((b)=>b.setAttribute('aria-pressed',String(b.dataset.posTab===tab)));
    const states = {not_connected:'Касса не подключена',schema_required:'Подключение ожидает подготовки базы',awaiting_sync:'Ожидаем первую полную синхронизацию',syncing:'Идёт сверка истории — данные могут быть неполными',connected:'Касса подключена',error:'Синхронизация остановлена'};
    const errors = {token_expired:'Токен истёк или отозван',forbidden:'Нет разрешения на чтение документов',not_installed:'Проверьте установку и оплату приложения',network:'Облако недоступно',rate_limit:'Лимит API: повторите позже',invalid_document:'Документ требует проверки',invalid_cursor:'Курсор сброшен: повторите полную сверку',api_error:'Ошибка API',invalid_response:'Некорректный ответ API'};
    const status = data.connection;
    find('posConnection').textContent = `${preview ? 'ПРЕДПРОСМОТР · ВЫМЫШЛЕННЫЕ ДАННЫЕ · ' : ''}${states[status.state] || status.state}. Последняя полная синхронизация: ${date(status.lastSuccessAt)}${status.errorCode ? '. '+(errors[status.errorCode] || 'Ошибка синхронизации') : ''}${status.lastSuccessAt && Date.now()-Date.parse(status.lastSuccessAt)>600000 ? '. Данные не обновлялись больше 10 минут' : ''}`;
    find('posSync').hidden = !canWrite();
    const metrics = data[tab];
    let html = tab==='app' ? `<p class="pos-note">Участников: ${escape(data.manual.clients)}. Журнал приложения: ${escape(data.manual.operations)} операций, ${escape(money(data.manual.checkCents))}. Записи сотрудников не подтверждены кассой и не складываются с кассовой выручкой.</p>` : '';
    if (!metrics) { find('posResult').innerHTML = html+'<p>Кассовая выручка пока не доступна.</p>'; return; }
    html += '<div class="pos-metrics">'+metric('Продажи',money(metrics.salesCents))+metric('Возвраты',money(metrics.returnsCents),metrics.returnDocuments+' документов')+metric('Итоговая выручка',money(metrics.netCents))+metric('Чеков продажи',metrics.receiptCount ?? 'неизвестно',metrics.saleDocuments+' документов продажи')+metric('Средний чек',money(metrics.averageCents),'Продажи / подтверждённое число чеков');
    if (tab==='app') html+=metric('Активных покупателей',metrics.activeBuyers)+metric('Повторных покупателей',metrics.repeatBuyers,'2 и более связанных продаж')+metric('Доля выручки приложения',data.linkedRevenueSharePercent == null ? '—' : data.linkedRevenueSharePercent+'%','От всех продаж кассы');
    else html+=metric('Связанные продажи',metrics.linkedSaleDocuments)+metric('Остальные продажи',metrics.unlinkedSaleDocuments,'Документы, а не уникальные гости');
    html+='</div>';
    if(metrics.documentsWithoutReceiptCount) html+='<p class="pos-note">У части документов нет числа печатных чеков. Количество чеков и средний чек не рассчитаны.</p>';
    html+=`<div class="pos-detail-grid">${series('По дням',metrics.days)}${series('По часам суток',metrics.hours)}</div><h4>Товары · по позициям Эвотора</h4>`;
    html+=table(['Товар','Количество с возвратами','Продажи','Возвраты','Итог'],metrics.products.map((p)=>[escape(p.name),escape(quantity(p.quantityMillis)+' '+p.measure),escape(money(p.salesCents)),escape(money(p.returnCents)),escape(money(p.netCents))]));
    html+='<h4>Оплата · детализация источника</h4>'+table(['Способ','Итог с возвратами'],metrics.payments.map((p)=>[escape(p.label),escape(money(p.amountCents))]));
    const docs=data.documents.filter((d)=>tab==='all'||d.clientId);
    html+='<h4>Документы кассы</h4>'+table(['Время','Документ / чек','Сумма','Связь'],docs.map((d)=>[
      escape(date(d.closedAt)),escape(d.number+' / '+(d.fiscal[0]?.receiptNumber ?? '—')),escape((d.type==='PAYBACK'?'Возврат · ':'')+money(d.amountCents)),
      d.clientId ? 'Профиль №'+escape(d.clientId) : canWrite() && d.linkable && d.type==='SELL' ? `<button type="button" data-pos-link="${escape(d.documentId)}">Связать с QR</button>` : 'Без связи'
    ]));
    if (data.documentsTruncated) html+='<p class="pos-note">Показаны последние 100 документов. Итоги рассчитаны за весь выбранный период.</p>';
    find('posResult').innerHTML=html;
  }
  async function reload() {
    const current=++serial;
    const params=new URLSearchParams({period:find('posPeriod').value,from:find('posFrom').value,to:find('posTo').value});
    try { const result=await request('/api/admin/pos/dashboard?'+params); if(current!==serial)return; data=result; render(); }
    catch(error){ if(current!==serial)return; data=null; find('posResult').textContent=''; find('posConnection').textContent=error.message; }
  }
  mount.addEventListener('click',async (event)=> {
    const button=event.target.closest('button'); if(!button)return;
    if(button.dataset.posTab) {tab=button.dataset.posTab;find('posLinkForm').hidden=true;render();return;}
    if(button.dataset.posLink){find('posDocument').value=button.dataset.posLink;find('posQr').value='';find('posLinkForm').hidden=false;find('posQr').focus();return;}
    if(button.id==='posRefresh')return reload();
    if(['posSync','posConfirm'].includes(button.id)) {
      button.disabled=true;
      try {
        if(button.id==='posSync') {
          const result=await request('/api/admin/pos/sync',{method:'POST',timeoutMs:20000,retries:0});
          await reload(); if(!result.complete&&!result.busy)find('posConnection').textContent+=' · История ещё загружается: нажмите «Загрузить из кассы» для следующей страницы.';
        } else {
          await request('/api/admin/pos/link',{method:'POST',body:JSON.stringify({documentId:find('posDocument').value,qr:find('posQr').value})});
          find('posLinkForm').hidden=true;await reload();
        }
      } catch(error) {find('posConnection').textContent=error.message;} finally {button.disabled=false;}
    }
  });
  find('posPeriod').addEventListener('change',()=> {const custom=find('posPeriod').value==='custom';find('posFromLabel').hidden=find('posToLabel').hidden=!custom;if(!custom)reload();});
  [find('posFrom'),find('posTo')].forEach((input)=>input.addEventListener('change',()=>{if(find('posFrom').value&&find('posTo').value)reload();}));
  const screen=mount.closest('[data-screen="admin"]');
  if(screen) new MutationObserver(()=>{if(screen.classList.contains('active'))reload();else{serial++;data=null;find('posResult').textContent='';find('posLinkForm').hidden=true;}}).observe(screen,{attributes:true,attributeFilter:['class']});
  if(preview || screen?.classList.contains('active'))reload();
})();
