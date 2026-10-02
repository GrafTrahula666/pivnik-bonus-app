// Offline preview only. Never wired to a live API or database.
import fs from 'node:fs/promises';
import { normalizeEvotorDocument, moscowPeriod } from '../pos/evotor-document.js';
import { summarizePos, posDashboards } from '../pos/analytics.js';
const today = new Date(Date.now() + 3*3600000).toISOString().slice(0,10);
const documents = [];
for (let i=0;i<18;i++) {
  const amount = (i%4+1)*250;
  const doc = normalizeEvotorDocument({id:`preview-${i}`,number:420+i,store_id:'preview',device_id:'preview',type:'SELL',close_date:`${today}T${String(10+i%8).padStart(2,'0')}:15:00+03:00`,
    body:{result_sum:amount,positions:[{product_id:i%2?'tincture':'beer',product_name:i%2?'Настойка · смородина':'Пиво · Blanche',quantity:i%2?1:0.5,measure_name:i%2?'шт':'л',result_sum:amount}],payments:[{type:i%3?'ELECTRON':'CASH',sum:amount}],pos_print_results:[{receipt_number:420+i,fiscal_document_number:500+i}]}
  },'preview');
  doc.clientId=i<11?String(100+i%5):null;documents.push(doc);
}
documents.push({...documents[0],documentId:'preview-return',type:'PAYBACK',number:'440',closedAt:`${today}T18:30:00+03:00`});
const css=await fs.readFile(new URL('../pos-admin.css',import.meta.url),'utf8');
const js=await fs.readFile(new URL('../pos-admin.js',import.meta.url),'utf8');
const body=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Пивник · предпросмотр аналитики кассы</title><style>body{margin:0;background:#f5efe4;font-family:Arial,sans-serif;color:#382e21}main{max-width:1080px;margin:auto;padding:24px}header{padding:12px 0}h1{font-size:28px;margin:10px 0}.preview-banner{padding:14px;border:1px solid #c0a06b;border-radius:12px;background:#fff8db} ${css}</style></head><body><main><header><small>ПИВНИК · АДМИН-ПАНЕЛЬ</small><h1>Аналитика продаж</h1><p class="preview-banner">ПРЕДПРОСМОТР — вымышленные данные. Переключайте разделы и периоды. Подключения к кассе, изменения профилей и базы здесь нет.</p></header><div id="posAdminMount"></div></main><script>
${moscowPeriod.toString()}
${summarizePos.toString()}
${posDashboards.toString()}
const documents=${JSON.stringify(documents)};
window.__PIVNIK_POS_PREVIEW__={request:async(path,options)=>{
 if(options?.method==='POST')throw new Error('Предпросмотр: изменение данных отключено');
 const params=Object.fromEntries(new URL(path,'https://preview.invalid').searchParams);
 const period=moscowPeriod(params);
 const selected=documents.filter(d=>Date.parse(d.closedAt)>=Date.parse(period.from)&&Date.parse(d.closedAt)<Date.parse(period.until));
 return {period,connection:{state:'connected',lastSuccessAt:new Date().toISOString()},...posDashboards(selected),manual:{clients:527,operations:14,checkCents:'890000'},documents:selected};
}};
${js}
</script></body></html>`;
await fs.writeFile(new URL('../ops/evotor-preview.html',import.meta.url),body);
console.log('ops/evotor-preview.html');
