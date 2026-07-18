// Telegram Mini App bootstrap. In an ordinary browser the demo still works normally.
const telegramApp = window.Telegram?.WebApp ?? null;
if (telegramApp) {
  telegramApp.ready();
  telegramApp.expand();
  try {
    telegramApp.setHeaderColor('#15110e');
    telegramApp.setBackgroundColor('#0e0c0a');
  } catch (_) {}

  const firstName = telegramApp.initDataUnsafe?.user?.first_name;
  const eyebrow = document.querySelector('.eyebrow');
  if (firstName && eyebrow) eyebrow.textContent = `Telegram Mini App · ${firstName}`;
}

const initialState = {
  balance: 1840,
  spend12m: 38400,
  shiftOpen: false,
  selectedClient: false,
  mode: 'accrue',
  cancellations: 0,
  operations: [],
  alerts: []
};
let state = JSON.parse(localStorage.getItem('pivnik_demo_state') || 'null') || structuredClone(initialState);
let qrTimer = null;
let qrSeconds = 30;
let qrToken = '';
let pendingSale = null;

const statusLevels = [
  {min:0,name:'Путник',bonus:.05,discount:0,next:10000},
  {min:10000,name:'Странник',bonus:.06,discount:.01,next:30000},
  {min:30000,name:'Гость таверны',bonus:.07,discount:.02,next:70000},
  {min:70000,name:'Завсегдатай',bonus:.08,discount:.03,next:100000},
  {min:100000,name:'Местный пьяница',bonus:.09,discount:.04,next:150000},
  {min:150000,name:'Легендарный пьяница',bonus:.10,discount:.05,next:500000},
  {min:500000,name:'Король Пивника',bonus:.20,discount:.10,next:null}
];
function currentStatus(){ return [...statusLevels].reverse().find(x=>state.spend12m>=x.min); }

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fmt = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n));
const save = () => localStorage.setItem('pivnik_demo_state', JSON.stringify(state));

function toast(text){
  const el=$('#toast'); el.textContent=text; el.classList.add('show');
  clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'),2200);
}

function drawPseudoQr(canvas, token){
  const ctx=canvas.getContext('2d'); const size=29; const cell=canvas.width/size;
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  let seed=[...token].reduce((a,c)=>((a*31+c.charCodeAt(0))>>>0),2166136261);
  const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
  const matrix=Array.from({length:size},()=>Array(size).fill(false));
  function finder(x,y){for(let r=0;r<7;r++)for(let c=0;c<7;c++){const edge=r===0||r===6||c===0||c===6;const core=r>=2&&r<=4&&c>=2&&c<=4;matrix[y+r][x+c]=edge||core;}}
  finder(1,1);finder(size-8,1);finder(1,size-8);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const inFinder=(x>=1&&x<8&&y>=1&&y<8)||(x>=size-8&&x<size-1&&y>=1&&y<8)||(x>=1&&x<8&&y>=size-8&&y<size-1);
    if(!inFinder) matrix[y][x]=rand()>.52;
  }
  ctx.fillStyle='#111';for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(matrix[y][x])ctx.fillRect(x*cell,y*cell,Math.ceil(cell),Math.ceil(cell));
}
function newQr(){
  qrToken=String(Math.floor(100000+Math.random()*900000)); qrSeconds=30;
  $('#qrToken').textContent=qrToken; $('#qrCountdown').textContent=qrSeconds;
  drawPseudoQr($('#bigQr'),qrToken); drawPseudoQr($('#miniQr'),qrToken);
}
function startQrTimer(){
  clearInterval(qrTimer); newQr();
  qrTimer=setInterval(()=>{qrSeconds--;$('#qrCountdown').textContent=qrSeconds;if(qrSeconds<=0)newQr();},1000);
}

function switchScreen(target){
  $$('.screen').forEach(s=>s.classList.toggle('active',s.dataset.screen===target));
  $$('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.target===target));
}
$$('.bottom-nav button').forEach(b=>b.addEventListener('click',()=>switchScreen(b.dataset.target)));

function openModal(id){$('#'+id).classList.add('open');$('#'+id).setAttribute('aria-hidden','false')}
function closeModal(id){$('#'+id).classList.remove('open');$('#'+id).setAttribute('aria-hidden','true')}
$$('[data-close]').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
$$('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeModal(m.id)}));
$('#openQr').onclick=$('#showQrButton').onclick=()=>{openModal('qrModal');startQrTimer()};

function renderStatusLevels(){
  const active=currentStatus();
  $('#statusLevelsList').innerHTML=statusLevels.map((level,index)=>{
    const isCurrent=level.name===active.name;
    const isReached=state.spend12m>=level.min;
    const discount=level.discount
      ? ` · скидка ${Math.round(level.discount*100)}%`
      : '';
    return `<article class="status-level ${isCurrent?'current':''} ${isReached?'reached':''}">
      <div class="status-rank">${index+1}</div>
      <div class="status-level-copy">
        <div class="status-level-head">
          <b>${level.name}</b>
          ${isCurrent?'<span>Ваш статус</span>':''}
        </div>
        <small>от ${fmt(level.min)} ₽ за 12 месяцев</small>
        <p>${Math.round(level.bonus*100)}% бонусами${discount}</p>
      </div>
      <div class="status-level-mark">${isCurrent?'●':isReached?'✓':'○'}</div>
    </article>`;
  }).join('');
}

$('#openStatuses').onclick=()=>{
  renderStatusLevels();
  openModal('statusesModal');
};

$$('.promo-card').forEach(card=>card.onclick=()=>{
  $('#detailTitle').textContent=card.querySelector('h3').textContent;
  $('#detailText').textContent=card.dataset.detail;
  openModal('detailModal');
});
$('#shopFeature').onclick=()=>{
  $('#detailTitle').textContent='Коллекционная кружка 001';
  $('#detailText').textContent='Покупается полностью за бонусы. После покупки товар исчезает из магазина, а заказ получает статус «Ожидает согласования». Дизайнер связывается с клиентом, после чего кружка изготавливается и отправляется или выдаётся в баре.';
  openModal('detailModal');
};
$$('[data-open="history"]').forEach(b=>b.onclick=()=>{switchScreen('admin');toast('В MVP история показана в журнале операций')});

function startShift(){
  state.shiftOpen=true; save(); render(); toast('Геолокация подтверждена. Смена открыта');
}
$('#startShift').onclick=startShift;

$('#scanClient').onclick=()=>{
  if(!state.shiftOpen)return toast('Сначала откройте смену');
  state.selectedClient=true;save();render();toast('Тестовый клиент найден');
};

$$('.mode').forEach(btn=>btn.onclick=()=>{
  state.mode=btn.dataset.mode; save(); renderModes(); calculate();
});
$('#saleAmount').addEventListener('input',calculate);

function renderModes(){
  $$('.mode').forEach(b=>b.classList.toggle('active',b.dataset.mode===state.mode));
}
function getAmount(){return Math.max(0,Number(String($('#saleAmount').value).replace(',','.'))||0)}
function calculate(){
  const amount=getAmount();
  let cash=amount, earn=0, spend=0;
  if(state.mode==='accrue'){
    const st=currentStatus(); const discount=amount*st.discount; cash=amount-discount; earn=cash*st.bonus;
  }else{
    const st=currentStatus(); spend=Math.min(state.balance,amount*.30);cash=amount-spend;earn=cash*st.bonus;
  }
  $('#cashDue').textContent=fmt(cash)+' ₽';$('#bonusEarn').textContent='+'+fmt(earn);
  $('#createSale').disabled=!(amount>0&&state.selectedClient&&state.shiftOpen);
  return {amount,cash,earn,spend};
}

$('#createSale').onclick=()=>{
  const calc=calculate();
  if(state.mode==='redeem'){
    pendingSale=calc;
    $('#confirmSummary').innerHTML=`<span>Сумма чека <b>${fmt(calc.amount)} ₽</b></span><span>Списать <b>${fmt(calc.spend)} бонусов</b></span><span>Оплатить <b>${fmt(calc.cash)} ₽</b></span>`;
    openModal('confirmModal');
  }else completeSale(calc);
};
$('#declineRedeem').onclick=()=>{closeModal('confirmModal');pendingSale=null;toast('Клиент отклонил списание')};
$('#approveRedeem').onclick=()=>{closeModal('confirmModal');completeSale(pendingSale);pendingSale=null};

function completeSale(calc){
  const suspicious=calc.amount>3000;
  state.balance=Math.max(0,state.balance-calc.spend+Math.round(calc.earn));
  state.spend12m+=calc.cash;
  const op={
    id:Date.now(),time:new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}),
    amount:calc.amount,cash:calc.cash,earn:Math.round(calc.earn),spend:Math.round(calc.spend),
    employee:'Аня',client:'Кирилл',cancelled:false,suspicious
  };
  state.operations.unshift(op);
  if(suspicious)state.alerts.unshift({id:op.id,text:`Крупная операция ${fmt(op.amount)} ₽ · Аня · Кирилл`});
  state.selectedClient=false;save();$('#saleAmount').value='';render();toast('Операция проведена');
}

function cancelOperation(id){
  const op=state.operations.find(o=>o.id===id);
  if(!op||op.cancelled)return;
  if(state.cancellations>=2){
    state.alerts.unshift({id:Date.now(),text:`Запрошена 3-я отмена за смену · требуется подтверждение владельца`});save();render();toast('Лимит исчерпан. Запрос отправлен владельцу');return;
  }
  const reason=prompt('Причина корректировки (обязательно):','Неверно введена сумма');
  if(!reason||!reason.trim())return toast('Без причины отмена невозможна');
  op.cancelled=true;op.cancelReason=reason.trim();state.cancellations++;
  state.balance=Math.max(0,state.balance+op.spend-op.earn);
  state.spend12m=Math.max(0,state.spend12m-op.cash);
  state.alerts.unshift({id:Date.now(),text:`Отмена ${fmt(op.amount)} ₽ · Аня · причина: ${op.cancelReason}`});
  save();render();toast('Создана обратная операция');
}
window.cancelOperation=cancelOperation;

function operationHtml(op,staff=false){
  return `<div class="op-row">
    <b>${op.cancelled?'ОТМЕНЕНО · ':''}${op.client}</b><strong>${fmt(op.amount)} ₽</strong>
    <small>${op.time} · ${op.employee}${op.spend?` · списано ${fmt(op.spend)}`:` · +${fmt(op.earn)} бонусов`}</small>
    ${staff&&!op.cancelled?`<button onclick="cancelOperation(${op.id})">Отменить</button>`:''}
  </div>`;
}

function render(){
  const st=currentStatus();
  $('#clientBalance').textContent=fmt(state.balance);
  $('#statusName').textContent=st.name;
  document.querySelector('.status-row .pill').textContent=Math.round(st.bonus*100)+'% бонусами';
  if(st.next){
    const pct=Math.max(0,Math.min(100,(state.spend12m-st.min)/(st.next-st.min)*100));
    $('#statusProgress').style.width=pct+'%';
    $('#statusProgressText').textContent=fmt(state.spend12m)+' / '+fmt(st.next)+' ₽';
  }else{
    $('#statusProgress').style.width='100%';
    $('#statusProgressText').textContent='Максимальный статус';
  }
  $('#shiftCard').classList.toggle('hidden',state.shiftOpen);
  $('#saleCard').classList.toggle('hidden',!state.shiftOpen);
  $('#staffOpsCard').classList.toggle('hidden',!state.shiftOpen);
  $('#shiftBadge').textContent=state.shiftOpen?'Смена открыта':'Смена закрыта';
  $('#shiftBadge').className='shift-badge '+(state.shiftOpen?'on':'off');
  $('#clientFound').classList.toggle('hidden',!state.selectedClient);
  $('#scanClient').classList.toggle('hidden',state.selectedClient);
  $('#cancelCounter').textContent=`Отмен: ${state.cancellations}/2`;
  $('#onShiftMetric').textContent=state.shiftOpen?'1':'0';
  const activeOps=state.operations.filter(o=>!o.cancelled);
  const total=activeOps.reduce((s,o)=>s+o.amount,0);
  $('#todayMetric').textContent=fmt(total)+' ₽';$('#todayOpsMetric').textContent=activeOps.length+' операций';
  $('#issuedMetric').textContent=fmt(18420+activeOps.reduce((s,o)=>s+o.earn,0));
  $('#staffOperations').className='operation-list'+(state.operations.length?'':' empty-state');
  $('#staffOperations').innerHTML=state.operations.length?state.operations.map(o=>operationHtml(o,true)).join(''):'Операций пока нет';
  $('#adminOperations').className='operation-list'+(state.operations.length?'':' empty-state');
  $('#adminOperations').innerHTML=state.operations.length?state.operations.map(o=>operationHtml(o,false)).join(''):'Операций пока нет';
  $('#alertCount').textContent=state.alerts.length;
  $('#alertsList').className=state.alerts.length?'':'empty-state';
  $('#alertsList').innerHTML=state.alerts.length?state.alerts.map(a=>`<div class="alert-item">${a.text}</div>`).join(''):'Новых событий нет';
  renderStatusLevels();
  renderModes();calculate();
}

$('#resetDemo').onclick=()=>{
  if(confirm('Сбросить все операции и вернуть исходный баланс?')){
    state=structuredClone(initialState);save();render();switchScreen('client');toast('Демо сброшено');
  }
};
$('#exportLog').onclick=()=>{
  const blob=new Blob([JSON.stringify({generatedAt:new Date().toISOString(),...state},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='pivnik-demo-log.json';a.click();URL.revokeObjectURL(a.href);toast('Журнал выгружен');
};
newQr();render();
