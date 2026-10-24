'use strict';

const $ = id => document.getElementById(id);
const FIELDS_IB = 'id,ib_code,name,email,phone,trading_account_number,created_at,updated_at';
const FIELDS_CLIENT = 'id,ib_id,full_name,email,phone,created_at,updated_at';
const FIELDS_ACC = 'id,client_id,account_number,label,created_at';
const FIELD_RECEIPT = 'id,reference_code,client_id,mt5_account_id,ib_id,client_name_snapshot,account_number,source_currency,source_amount,amount_iqd,amount_usd,exchange_rate,created_by,created_at,record_status';
const CONFIG = window.SKYGATE_CONFIG || {};
const IS_LIVE = Boolean(CONFIG.supabaseUrl && CONFIG.supabasePublishableKey && window.supabase?.createClient);
const db = IS_LIVE ? window.supabase.createClient(CONFIG.supabaseUrl,CONFIG.supabasePublishableKey) : null;

const S = {
  user:null,role:'',ibs:[],clients:[],accounts:[],receipts:[],rate:1500,
  rateUpdatedAt:null,receipt:null,chosenClient:null,chosenAccount:null,
  directorySequence:0,ibSequence:0,vaultContext:null,vaultTimer:null,
  mfaFactor:null,enrollFactor:null,demoClientCounter:2
};

function escapeHtml(s='') { return String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function errorMsg(err){
  const message=String(err?.message || err || 'An unexpected error occurred.');
  if(err?.code==='23505' || /duplicate key|already exists|unique constraint/i.test(message)) return 'This client is already registered, or the email, phone, IB number, or MT5 account is already in the database.';
  if(/permission denied|row-level|Unauthorized/i.test(message)) return 'Database permission denied. Sign in as an approved SkyGate staff user.';
  return message;
}
function showMsg(id,msg,bad=false){const el=$(id);if(!el)return;el.textContent=msg;el.classList.toggle('bad',bad);}
let toastTimer;
function toast(msg){const node=$('toast');node.textContent=msg;node.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.add('hidden'),4100);}
function cleanText(v){const t=String(v??'').trim();return t||null;}
function formatUSD(v){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v)||0);}
function formatIQD(v){return new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(Number(v)||0)+' IQD';}
function fmtRate(v){return new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(Number(v)||0);}
function dateIraq(v){return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Baghdad',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v))+' (Iraq)';}
function rounded2(x){return Math.round((Number(x)+Number.EPSILON)*100)/100;}
function formattedClientIb(client){const ib=S.ibs.find(i=>i.id===client.ib_id);return ib?`${ib.ib_code} · ${ib.name}`:'No assigned IB';}
function acctForClient(id){return S.accounts.filter(a=>a.client_id===id);}
function byId(collection,id){return collection.find(x=>x.id===id);}
function setView(el,show){el.classList.toggle('hidden',!show);}
function accountTags(arr){return `<div class="account-tags">${arr.length?arr.map(a=>`<span class="account-tag">MT5 ${escapeHtml(a.account_number)}</span>`).join(''):'<span class="meta">No linked MT5 accounts</span>'}</div>`;}
function lineMatch(t,value){return String(value??'').toLowerCase().includes(t.toLowerCase());}
function demoData(){
  S.ibs=[{id:'ib-demo-1',ib_code:'IB-100',name:'Example IB Partner',email:'ib@example.test',phone:'',trading_account_number:'991234'}];
  S.clients=[{id:'client-demo-1',ib_id:'ib-demo-1',full_name:'Sample Client Ahmed',email:'sample@example.test',phone:'+9647000000000'},{id:'client-demo-2',ib_id:'ib-demo-1',full_name:'Sample Client Sara',email:'sara@example.test',phone:'+9647111111111'}];
  S.accounts=[{id:'acct-demo-1',client_id:'client-demo-1',account_number:'1315001'},{id:'acct-demo-2',client_id:'client-demo-1',account_number:'1315002'},{id:'acct-demo-3',client_id:'client-demo-2',account_number:'1499888'}];
  S.receipts=[];S.rate=1500;
}

async function start(){
  wireEvents();
  $('modeChip').textContent=IS_LIVE?'LIVE':'DEMO';
  if(!IS_LIVE){demoData();setView($('workspace'),true);setView($('demoNotice'),true);$('configStatus').textContent='Demo mode · not connected';$('roleStatus').textContent='Demo';await redrawData();return;}
  try{
    const {data,error}=await db.auth.getSession();if(error)throw error;
    if(data.session){await signedIn(data.session.user);}else{setView($('loginView'),true);}
  }catch(e){setView($('loginView'),true);showMsg('loginMsg',errorMsg(e),true);}
}
async function signedIn(user){
  S.user=user;
  const {data,error}=await db.from('staff_users').select('role').eq('user_id',user.id).maybeSingle();
  if(error || !data){await db.auth.signOut();S.user=null;setView($('workspace'),false);setView($('loginView'),true);showMsg('loginMsg','Your account is signed in but is not approved in public.staff_users. Add your Auth User UID with the SQL Editor.',true);return;}
  S.role=data.role;$('roleStatus').textContent=data.role;$('configStatus').textContent='Connected to Supabase';
  $('logoutBtn').classList.remove('hidden');setView($('loginView'),false);setView($('workspace'),true);setView($('demoNotice'),false);
  try { await refreshAll();await checkMfa();}catch(e){toast('Database error: '+errorMsg(e));}
}
async function refreshAll(){
  if(!IS_LIVE){await redrawData();return;}
  const requests=[
    db.from('ibs').select(FIELDS_IB).order('name').limit(1000),
    db.from('clients').select(FIELDS_CLIENT).order('full_name').limit(1000),
    db.from('mt5_accounts').select(FIELDS_ACC).order('account_number').limit(1000),
    db.from('exchange_rates').select('id,iqd_per_usd,updated_at').eq('id',1).maybeSingle(),
    db.from('deposit_receipts').select(FIELD_RECEIPT).order('created_at',{ascending:false}).limit(100)
  ];
  const out=await Promise.all(requests);for(const r of out){if(r.error)throw r.error;}
  S.ibs=out[0].data||[];S.clients=out[1].data||[];S.accounts=out[2].data||[];S.receipts=out[4].data||[];
  S.rate=Number(out[3].data?.iqd_per_usd ?? 1500);S.rateUpdatedAt=out[3].data?.updated_at||null;
  $('receiptRate').value=S.rate;
  await redrawData();
}
async function redrawData(){
  fillIbOptions(S.ibs);renderClients(S.clients);renderIbs(S.ibs);renderHistory();updateConversion();renderSettingsRate();
}
function renderSettingsRate(){ $('settingsRate').textContent=`${fmtRate(S.rate)} IQD / USD`;
  $('rateMeta').textContent=S.rateUpdatedAt?`Saved in Supabase · ${dateIraq(S.rateUpdatedAt)}`:(IS_LIVE?'Rate not yet updated by staff. Confirm before real use.':'Demo rate. Connect Supabase to save across devices.');
}
function openTab(tab){
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.add('hidden'));
  $(`tab-${tab}`).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.tab===tab));
  if(tab==='enquiry'){scheduleSearch('enquirySearch','enquiryResults');}
  if(tab==='settings'){checkMfa();}
  window.scrollTo({top:0,behavior:'smooth'});
}
function calculate(){
  const rate=Number($('receiptRate').value),amount=Number($('receiptAmountInput').value),cur=$('receiptCurrency').value;
  if(!(rate>0 && amount>0 && Number.isFinite(rate)&&Number.isFinite(amount)))return {valid:false,usd:0,iqd:0};
  let usd,iqd;
  if(cur==='USD'){usd=rounded2(amount);iqd=Math.round(usd*rate);}
  else{iqd=Math.round(amount);usd=rounded2(iqd/rate);}
  return {valid:usd>0&&iqd>0,usd,iqd,rate,source:cur,sourceAmount:amount};
}
function updateConversion(){const val=calculate();$('usdPreview').textContent=formatUSD(val.usd);$('iqdPreview').textContent=formatIQD(val.iqd);}
async function saveRate(){
  const rate=Number($('receiptRate').value);
  if(!Number.isFinite(rate)||rate<=0){toast('Enter a positive IQD per USD exchange rate.');return;}
  if(!IS_LIVE){S.rate=rate;S.rateUpdatedAt=null;renderSettingsRate();toast('Demo rate updated in this session only.');return;}
  try{
    const {data,error}=await db.from('exchange_rates').upsert({id:1,iqd_per_usd:rate,updated_by:S.user.id,updated_at:new Date().toISOString()},{onConflict:'id'}).select('iqd_per_usd,updated_at').single();
    if(error)throw error;S.rate=Number(data.iqd_per_usd);S.rateUpdatedAt=data.updated_at;renderSettingsRate();toast('Exchange rate saved in Supabase.');
  }catch(e){toast('Exchange rate could not be saved: '+errorMsg(e));}
}
function makeRef(){const raw=(crypto.randomUUID?crypto.randomUUID().replaceAll('-','').slice(0,9):Math.random().toString(36).slice(2,11)).toUpperCase();return `SG-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${raw}`;}
function fillReceiptFromClient(client,account){
  S.chosenClient=client?.id||null;S.chosenAccount=account?.id||null;
  $('receiptName').value=client?.full_name||'';
  $('receiptAccount').value=account?.account_number||'';
  $('receiptSearch').value=client?`${client.full_name} · ${account?.account_number||'client'}`:'';
  $('receiptMatches').innerHTML='';
}
function generateReceipt(){
  const account=$('receiptAccount').value.trim();const name=$('receiptName').value.trim()||'Not specified';const c=calculate();
  if(!/^\d{4,24}$/.test(account)){showMsg('receiptMsg','Enter an MT5 account number with 4–24 digits. This account does not need to be registered.',true);return;}
  if(!c.valid){showMsg('receiptMsg','Enter a valid amount and a positive exchange rate.',true);return;}
  const linkedAcc=byId(S.accounts,S.chosenAccount);
  if(linkedAcc?.account_number!==account){S.chosenAccount=null;S.chosenClient=null;}
  const linkedClient=byId(S.clients,S.chosenClient);
  const m={id:null,reference_code:makeRef(),account_number:account,client_name_snapshot:name,
    client_id:linkedClient?.id||null,mt5_account_id:linkedAcc?.id||null,ib_id:linkedClient?.ib_id||null,
    source_currency:c.source,source_amount:c.source==='USD'?rounded2(c.sourceAmount):Math.round(c.sourceAmount),
    amount_iqd:c.iqd,amount_usd:c.usd,exchange_rate:c.rate,created_at:new Date().toISOString(),record_status:'recorded'};
  S.receipt=m;drawReceipt(m);showMsg('receiptMsg','Receipt generated. Review details before saving to Supabase.');
}
function drawReceipt(m){
  $('receiptPlaceholder').classList.add('hidden');$('receiptReady').classList.remove('hidden');
  $('rDate').textContent=dateIraq(m.created_at);
  $('rPrimary').textContent=m.source_currency==='USD'?formatUSD(m.amount_usd):formatIQD(m.amount_iqd);
  $('rSecondary').textContent=m.source_currency==='USD'?`Equivalent: ${formatIQD(m.amount_iqd)}`:`Equivalent: ${formatUSD(m.amount_usd)}`;
  $('rName').textContent=m.client_name_snapshot||'Not specified';$('rAccount').textContent=m.account_number;
  $('rUSD').textContent=formatUSD(m.amount_usd);$('rIQD').textContent=formatIQD(m.amount_iqd);
  $('rRate').textContent=`1 USD = ${fmtRate(m.exchange_rate)} IQD`;$('rRef').textContent=m.reference_code;
  $('recordBtn').disabled=Boolean(m.id);$('recordBtn').textContent=m.id?'Saved in Supabase':'Save record to Supabase';
  showMsg('recordMsg',m.id?'Saved SkyGate intake record. Broker credit is not independently verified.':'Not saved yet. Screenshot view is ready.');
}
async function saveReceipt(){
  const m=S.receipt;if(!m)return;
  if(!IS_LIVE){showMsg('recordMsg','Demo only: connect Supabase to save real receipt history.',true);return;}
  if(m.id){toast('Receipt is already saved.');return;}
  try{
    const payload={reference_code:m.reference_code,client_id:m.client_id,mt5_account_id:m.mt5_account_id,ib_id:m.ib_id,
      client_name_snapshot:m.client_name_snapshot,account_number:m.account_number,amount_iqd:m.amount_iqd,
      amount_usd:m.amount_usd,exchange_rate:m.exchange_rate,source_currency:m.source_currency,
      source_amount:m.source_amount,record_status:'recorded',created_by:S.user.id};
    const {data,error}=await db.from('deposit_receipts').insert(payload).select(FIELD_RECEIPT).single();
    if(error)throw error;S.receipt=data;S.receipts.unshift(data);drawReceipt(data);renderHistory();toast('Receipt record saved.');
  }catch(e){showMsg('recordMsg',errorMsg(e),true);}
}
function startScreenshot(){
  const target=$('screenshotTarget');target.replaceChildren($('receiptCard'));
  setView($('screenshotOverlay'),true);document.body.style.overflow='hidden';
  window.scrollTo(0,0);
}
function endScreenshot(){
  $('receiptReady').insertBefore($('receiptCard'),$('receiptTools'));
  setView($('screenshotOverlay'),false);document.body.style.overflow='';
}
function openHistory(ref){const found=S.receipts.find(x=>x.id===ref);if(!found)return;S.receipt=found;openTab('receipt');drawReceipt(found);$('receiptAccount').value=found.account_number;$('receiptName').value=found.client_name_snapshot;$('receiptCurrency').value=found.source_currency;$('receiptAmountInput').value=found.source_amount;$('receiptRate').value=found.exchange_rate;updateConversion();}
function renderHistory(){const node=$('historyList');if(!S.receipts.length){node.innerHTML='<div class="empty-result">No saved deposit records yet.</div>';return;}
  node.innerHTML=S.receipts.map(m=>`<div class="result-card"><div class="result-header"><div><h3>${escapeHtml(m.account_number)} · ${escapeHtml(m.client_name_snapshot)}</h3><p>${escapeHtml(formatUSD(m.amount_usd))} / ${escapeHtml(formatIQD(m.amount_iqd))}</p><div class="meta">${escapeHtml(dateIraq(m.created_at))} · ${escapeHtml(m.reference_code)}</div></div><span class="small-tag">Recorded</span></div><div class="result-actions"><button type="button" data-action="history" data-id="${escapeHtml(m.id)}">Reopen receipt</button></div></div>`).join('');
}

function sanitizeSearch(input){return String(input||'').trim().replace(/[%,()*]/g,'').slice(0,100);}
async function searchDirectory(term){
  const t=sanitizeSearch(term);
  if(!IS_LIVE){
    const matches=S.ibs.filter(i=>[i.name,i.ib_code,i.email,i.trading_account_number].some(v=>lineMatch(t,v)));
    const clientIds=new Set(S.accounts.filter(a=>a.account_number.startsWith(t)).map(a=>a.client_id));
    const clients=S.clients.filter(c=>[c.full_name,c.email,c.phone].some(v=>lineMatch(t,v)) || clientIds.has(c.id) || matches.some(i=>i.id===c.ib_id));
    return {clients,ibs:matches,accounts:S.accounts.filter(a=>clients.some(c=>c.id===a.client_id))};
  }
  // Each keystroke runs new parameterized Supabase queries; results are not limited to previously downloaded local records.
  const [ir,cr,ar]=await Promise.all([
    db.from('ibs').select(FIELDS_IB).or(`name.ilike.%${t}%,ib_code.ilike.${t}%,email.ilike.%${t}%,trading_account_number.ilike.${t}%`).limit(25),
    db.from('clients').select(FIELDS_CLIENT).or(`full_name.ilike.%${t}%,email.ilike.%${t}%,phone.ilike.%${t}%`).limit(35),
    db.from('mt5_accounts').select(FIELDS_ACC).ilike('account_number',`${t}%`).limit(35)
  ]);
  for(const r of [ir,cr,ar])if(r.error)throw r.error;
  const ibs=ir.data||[];const clients=cr.data||[];const accs=ar.data||[];
  const foundClients=new Map(clients.map(c=>[c.id,c]));
  const extraIds=[...new Set(accs.map(a=>a.client_id).filter(id=>!foundClients.has(id)))];
  if(extraIds.length){const r=await db.from('clients').select(FIELDS_CLIENT).in('id',extraIds);if(r.error)throw r.error;(r.data||[]).forEach(c=>foundClients.set(c.id,c));}
  // An IB search should also show its linked clients.
  if(ibs.length){const r=await db.from('clients').select(FIELDS_CLIENT).in('ib_id',ibs.map(i=>i.id)).limit(80);if(r.error)throw r.error;(r.data||[]).forEach(c=>foundClients.set(c.id,c));}
  const foundIds=[...foundClients.keys()];
  let linked=[];
  if(foundIds.length){const r=await db.from('mt5_accounts').select(FIELDS_ACC).in('client_id',foundIds).limit(250);if(r.error)throw r.error;linked=r.data||[];}
  // Update local known records with the current server results; don't rely solely on the first 1000 records loaded.
  for(const row of foundClients.values())mergeCache(S.clients,row);
  for(const row of ibs)mergeCache(S.ibs,row);
  for(const row of linked)mergeCache(S.accounts,row);
  return {clients:[...foundClients.values()],ibs,accounts:linked};
}
function mergeCache(dest,item){const i=dest.findIndex(x=>x.id===item.id);if(i<0)dest.push(item);else dest[i]=item;}
const debounceTimers={};
function scheduleSearch(inputId,resultId){
  clearTimeout(debounceTimers[inputId]);const token=++S.directorySequence;
  debounceTimers[inputId]=setTimeout(async()=>{
    const term=$(inputId).value.trim();if(!term){if(resultId==='enquiryResults'){$(resultId).innerHTML='<div class="empty-result">Enter a client name, email, IB name or MT5 account prefix to search.</div>';}else if(resultId==='receiptMatches')$(resultId).innerHTML='';else if(resultId==='clientList')renderClients(S.clients);else if(resultId==='ibList')renderIbs(S.ibs);return;}
    if(resultId==='enquiryResults')$(resultId).innerHTML='<div class="empty-result">Searching Supabase…</div>';
    try{const res=await searchDirectory(term);if(token!==S.directorySequence)return;
      if(resultId==='receiptMatches')renderReceiptMatches(res);
      else if(resultId==='clientList')renderClients(res.clients);
      else if(resultId==='ibList')renderIbs(res.ibs);
      else renderEnquiry(res);
    }catch(e){if(token===S.directorySequence)$(resultId).innerHTML=`<div class="empty-result">${escapeHtml(errorMsg(e))}</div>`;}
  },240);
}
function renderReceiptMatches(results){const all=[];
  for(const c of results.clients)for(const a of results.accounts.filter(a=>a.client_id===c.id))all.push({c,a});
  $('receiptMatches').innerHTML=all.length?all.slice(0,25).map(x=>`<button type="button" class="match-option" data-action="chooseReceipt" data-id="${escapeHtml(x.c.id)}" data-account="${escapeHtml(x.a.id)}"><b>${escapeHtml(x.c.full_name)}</b><small>MT5 ${escapeHtml(x.a.account_number)} · ${escapeHtml(formattedClientIb(x.c))}</small></button>`).join(''):'<div class="field-note">No registered match. You can enter the MT5 number manually below.</div>';
}
function renderClientCard(c,accounts){const ib=byId(S.ibs,c.ib_id);
  return `<article class="result-card"><div class="result-header"><div><h3>${escapeHtml(c.full_name)}</h3><div class="meta">${escapeHtml(ib?`${ib.ib_code} · ${ib.name}`:'Unassigned IB')}</div></div><span class="small-tag">Client</span></div>
  <p>${escapeHtml(c.email||'No email')} · ${escapeHtml(c.phone||'No phone')}</p>${accountTags(accounts)}
  <div class="result-actions"><button type="button" data-action="editClient" data-id="${escapeHtml(c.id)}">Edit details</button><button type="button" data-action="reveal" data-kind="client" data-id="${escapeHtml(c.id)}">Reveal portal password</button>${accounts.length?`<button type="button" data-action="useReceipt" data-id="${escapeHtml(c.id)}" data-account="${escapeHtml(accounts[0].id)}">Generate receipt</button>`:''}</div></article>`;
}
function renderIbCard(i,clients){return `<article class="result-card"><div class="result-header"><div><h3>${escapeHtml(i.name)}</h3><div class="meta">IB ${escapeHtml(i.ib_code)} · Trading ${escapeHtml(i.trading_account_number||'—')}</div></div><span class="small-tag">${clients.length} clients</span></div><p>${escapeHtml(i.email||'No email')} ${i.phone?' · '+escapeHtml(i.phone):''}</p>${clients.length?`<p><b>Clients:</b> ${escapeHtml(clients.map(c=>c.full_name).join(', '))}</p>`:''}<div class="result-actions"><button data-action="editIb" data-id="${escapeHtml(i.id)}" type="button">Edit IB</button><button data-action="reveal" data-kind="ib" data-id="${escapeHtml(i.id)}" type="button">Reveal portal password</button></div></article>`;}
function renderClients(data){$('clientList').innerHTML=data.length?data.slice(0,60).map(c=>renderClientCard(c,acctForClient(c.id))).join(''):'<div class="empty-result">No clients found.</div>';}
function renderIbs(data){$('ibList').innerHTML=data.length?data.slice(0,60).map(i=>renderIbCard(i,S.clients.filter(c=>c.ib_id===i.id))).join(''):'<div class="empty-result">No IBs found.</div>';}
function renderEnquiry(data){const node=$('enquiryResults');const ibCards=data.ibs.map(i=>renderIbCard(i,data.clients.filter(c=>c.ib_id===i.id)));
  const clientCards=data.clients.map(c=>renderClientCard(c,data.accounts.filter(a=>a.client_id===c.id)));
  node.innerHTML=ibCards.join('')+clientCards.join('')||'<div class="empty-result">No matching clients or IBs. Try a different name or MT5 prefix.</div>';
}
function fillIbOptions(ibs){$('ibSuggestions').innerHTML=ibs.map(i=>`<option value="${escapeHtml(ibLabel(i))}"></option>`).join('');}
function ibLabel(i){return `${i.ib_code} | ${i.name}`;}
function pickIb(){const str=$('clientIbLookup').value.trim();if(!str)return null;const row=S.ibs.find(i=>ibLabel(i).toLowerCase()===str.toLowerCase());if(!row)throw Error('Select an IB from the suggestions, or leave the IB field empty.');return row.id;}
async function suggestIB(){const q=sanitizeSearch($('clientIbLookup').value);if(!IS_LIVE){fillIbOptions(S.ibs.filter(i=>[i.name,i.ib_code,i.email,i.trading_account_number].some(x=>lineMatch(q,x))));return;}
  const token=++S.ibSequence;
  try{
    const {data,error}=await db.from('ibs').select(FIELDS_IB).or(`name.ilike.%${q}%,ib_code.ilike.${q}%,email.ilike.%${q}%,trading_account_number.ilike.${q}%`).limit(40);
    if(error)throw error;if(token!==S.ibSequence)return;(data||[]).forEach(i=>mergeCache(S.ibs,i));fillIbOptions(data||[]);
  }catch(e){$('selectedIbNote').textContent=errorMsg(e);}
}
function addAccountLine(value='',locked=false){const el=document.createElement('div');el.className='account-line';
  const input=document.createElement('input');input.type='text';input.inputMode='numeric';input.maxLength=24;input.placeholder=locked?'Existing account':'MT5 account number';input.value=value;input.className='mt5-input';input.readOnly=locked;input.dataset.locked=String(locked);
  const btn=document.createElement('button');btn.type='button';btn.textContent=locked?'✓':'×';btn.disabled=locked;btn.setAttribute('aria-label','Remove account field');btn.addEventListener('click',()=>el.remove());el.append(input,btn);$('accountInputs').append(el);
}
function resetClientForm(){ $('clientForm').reset();$('editClientId').value='';$('clientFormTitle').textContent='Register client';$('clientSaveBtn').textContent='Register client';$('cancelClientEdit').classList.add('hidden');$('accountInputs').innerHTML='';addAccountLine();showMsg('clientMsg','');$('selectedIbNote').textContent='Select an existing IB, or leave empty if none.';}
function editClient(id){const c=byId(S.clients,id);if(!c)return;openTab('clients');resetClientForm();$('editClientId').value=c.id;$('clientFormTitle').textContent='Edit client';$('clientSaveBtn').textContent='Save changes';$('cancelClientEdit').classList.remove('hidden');$('clientFullName').value=c.full_name;$('clientEmail').value=c.email||'';$('clientPhone').value=c.phone||'';const ib=byId(S.ibs,c.ib_id);$('clientIbLookup').value=ib?ibLabel(ib):'';$('accountInputs').innerHTML='';acctForClient(c.id).forEach(a=>addAccountLine(a.account_number,true));addAccountLine();window.scrollTo({top:0,behavior:'smooth'});}
function findDuplicateClient(email,phone,acctNums,exceptId=null){
  const cleanPhone=String(phone||'').replace(/\D/g,'');
  const dup=S.clients.find(c=>c.id!==exceptId && ((email && c.email?.trim().toLowerCase()===email.toLowerCase()) || (cleanPhone && String(c.phone||'').replace(/\D/g,'')===cleanPhone)));
  if(dup)return `Client already registered: ${dup.full_name}.`;
  const dupAcct=S.accounts.find(a=>acctNums.includes(a.account_number)&&a.client_id!==exceptId);
  if(dupAcct)return `Client already registered: MT5 account ${dupAcct.account_number} belongs to another client.`;
  return null;
}
function getMt5Form(){return [...$('accountInputs').querySelectorAll('input')].map(e=>({value:e.value.trim(),locked:e.dataset.locked==='true'})).filter(x=>x.value);}
async function maybeEncrypt(portal,vault){
  if(!portal){return null;}if(!IS_LIVE)throw Error('Portal password storage requires configured Supabase. Demo records must not include real credentials.');
  if(!window.isSecureContext||!crypto?.subtle)throw Error('Encryption requires HTTPS and a secure browser.');
  if(vault.length<12)throw Error('Enter a strong, separate vault passphrase of at least 12 characters.');
  return encryptSecret(portal,vault);
}
async function saveClient(e){e.preventDefault();showMsg('clientMsg','');let savedId=null;
  try{
    const id=$('editClientId').value||null,name=$('clientFullName').value.trim(),email=cleanText($('clientEmail').value)?.toLowerCase(),phone=cleanText($('clientPhone').value),ib_id=pickIb();
    const lines=getMt5Form(),accounts=lines.map(x=>x.value),newAccounts=lines.filter(x=>!x.locked).map(x=>x.value);
    if(!name)throw Error('Client full name is required.');
    if(!id&&!accounts.length)throw Error('Enter at least one MT5 account.');
    if(accounts.some(a=>!/^\d{4,24}$/.test(a)))throw Error('Each MT5 number must be 4–24 digits.');
    if(new Set(accounts).size!==accounts.length)throw Error('Client already registered: duplicated MT5 number in the form.');
    const dup=findDuplicateClient(email,phone,accounts,id);if(dup)throw Error(dup);
    const password=$('clientPortalPass').value,passphrase=$('clientVaultPass').value;
    const portal_secret=await maybeEncrypt(password,passphrase);
    if(IS_LIVE){
      if(id){const changes={full_name:name,email,phone,ib_id,updated_at:new Date().toISOString()};if(portal_secret)changes.portal_secret=portal_secret;
        const {error}=await db.from('clients').update(changes).eq('id',id);if(error)throw error;
        if(newAccounts.length){const r=await db.from('mt5_accounts').insert(newAccounts.map(account_number=>({account_number,client_id:id})));if(r.error)throw r.error;} savedId=id;
      }else{
        const {data,error}=await db.rpc('register_client',{p_full_name:name,p_email:email,p_phone:phone,p_ib_id:ib_id,p_mt5_numbers:accounts,p_portal_secret:portal_secret});if(error)throw error;savedId=data;
      }
      await refreshAll();
    }else{
      if(id){Object.assign(byId(S.clients,id),{full_name:name,email,phone,ib_id});newAccounts.forEach(account_number=>S.accounts.push({id:`acct-demo-${Date.now()}-${Math.random()}`,client_id:id,account_number}));savedId=id;}
      else{savedId=`client-demo-${++S.demoClientCounter}`;S.clients.push({id:savedId,full_name:name,email,phone,ib_id});accounts.forEach(account_number=>S.accounts.push({id:`acct-demo-${Date.now()}-${Math.random()}`,client_id:savedId,account_number}));}
      await redrawData();
    }
    resetClientForm();showMsg('clientMsg',`Client saved successfully${IS_LIVE?' in Supabase':' in demo memory'} (${savedId}).`);toast('Client saved.');
  }catch(err){showMsg('clientMsg',errorMsg(err),true);}finally{$('clientPortalPass').value='';$('clientVaultPass').value='';}
}
function resetIbForm(){$('ibForm').reset();$('editIbId').value='';$('ibFormTitle').textContent='Add introducing broker';$('ibSaveBtn').textContent='Save IB';$('cancelIbEdit').classList.add('hidden');showMsg('ibMsg','');}
function editIb(id){const i=byId(S.ibs,id);if(!i)return;openTab('ibs');resetIbForm();$('editIbId').value=i.id;$('ibFormTitle').textContent='Edit introducing broker';$('ibSaveBtn').textContent='Save changes';$('cancelIbEdit').classList.remove('hidden');$('ibCode').value=i.ib_code;$('ibName').value=i.name;$('ibEmail').value=i.email||'';$('ibPhone').value=i.phone||'';$('ibTradingAccount').value=i.trading_account_number||'';window.scrollTo({top:0,behavior:'smooth'});}
async function saveIb(e){e.preventDefault();showMsg('ibMsg','');try{
  const id=$('editIbId').value||null, ib_code=$('ibCode').value.trim(),name=$('ibName').value.trim(),email=cleanText($('ibEmail').value)?.toLowerCase(),phone=cleanText($('ibPhone').value),trading_account_number=cleanText($('ibTradingAccount').value);
  if(!ib_code||!name)throw Error('IB number and full name are required.');
  if(trading_account_number&&!/^\d{4,24}$/.test(trading_account_number))throw Error('IB trading account must contain 4–24 digits.');
  if(S.ibs.some(i=>i.id!==id&&(i.ib_code.toLowerCase()===ib_code.toLowerCase() || email&&i.email?.toLowerCase()===email || trading_account_number&&i.trading_account_number===trading_account_number)))throw Error('IB already registered (same number, email or trading account).');
  const pass=$('ibPortalPass').value,vault=$('ibVaultPass').value,portal_secret=await maybeEncrypt(pass,vault);
  const values={ib_code,name,email,phone,trading_account_number};if(portal_secret)values.portal_secret=portal_secret;
  if(IS_LIVE){let r;if(id)r=await db.from('ibs').update({...values,updated_at:new Date().toISOString()}).eq('id',id);else r=await db.from('ibs').insert(values);if(r.error)throw r.error;await refreshAll();}
  else{if(id)Object.assign(byId(S.ibs,id),values);else S.ibs.push({...values,id:`ib-demo-${Date.now()}`});await redrawData();}
  resetIbForm();showMsg('ibMsg','IB saved successfully.');toast('IB saved.');
}catch(err){showMsg('ibMsg',errorMsg(err),true);}finally{$('ibPortalPass').value='';$('ibVaultPass').value='';}}

// AES-GCM encrypted portal credentials. Only ciphertext, salt, IV and version are stored.
// The vault passphrase never leaves this browser or appears in GitHub/config files.
const te=new TextEncoder();const td=new TextDecoder();
function bytesToB64(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);}
function b64ToBytes(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
async function deriveVaultKey(passphrase,salt,usage){
  const material=await crypto.subtle.importKey('raw',te.encode(passphrase),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,[usage]);
}
async function encryptSecret(secret,passphrase){
  const salt=crypto.getRandomValues(new Uint8Array(16));const iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await deriveVaultKey(passphrase,salt,'encrypt');const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,te.encode(secret));
  return {version:1,algorithm:'AES-256-GCM',salt:bytesToB64(salt),iv:bytesToB64(iv),ciphertext:bytesToB64(new Uint8Array(cipher))};
}
async function decryptSecret(obj,passphrase){
  if(!obj||obj.version!==1||obj.algorithm!=='AES-256-GCM')throw Error('Unsupported stored credential format.');
  const key=await deriveVaultKey(passphrase,b64ToBytes(obj.salt),'decrypt');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(obj.iv)},key,b64ToBytes(obj.ciphertext));
  return td.decode(plain);
}
function openVault(kind,id){
  if(!IS_LIVE){toast('Password vault is disabled in demo mode.');return;}
  S.vaultContext={kind,id};$('vaultInput').value='';$('vaultResult').textContent='';$('vaultResult').classList.add('hidden');showMsg('vaultMsg','');$('passwordModal').classList.remove('hidden');$('vaultInput').focus();
}
function closeVault(){clearTimeout(S.vaultTimer);$('passwordModal').classList.add('hidden');$('vaultInput').value='';$('vaultResult').textContent='';$('vaultResult').classList.add('hidden');S.vaultContext=null;}
async function revealVault(){const ctx=S.vaultContext;if(!ctx)return;const passphrase=$('vaultInput').value;
  if(!passphrase){showMsg('vaultMsg','Enter your vault passphrase.',true);return;}
  showMsg('vaultMsg','Verifying MFA and decrypting…');
  try{
    const {data,error}=await db.rpc('reveal_portal_secret',{p_kind:ctx.kind,p_record_id:ctx.id});if(error)throw error;
    const plain=await decryptSecret(data,passphrase);
    $('vaultResult').textContent=plain;$('vaultResult').classList.remove('hidden');$('vaultInput').value='';showMsg('vaultMsg','Visible for 20 seconds. Do not share through unsecured channels.');
    clearTimeout(S.vaultTimer);S.vaultTimer=setTimeout(closeVault,20000);
  }catch(e){showMsg('vaultMsg',/MFA/i.test(errorMsg(e))?'You must verify MFA first. Open Settings → Security settings.':/decrypt|operation-specific/i.test(errorMsg(e))?'Wrong vault passphrase or invalid encrypted data.':errorMsg(e),true);}
}

async function checkMfa(){if(!IS_LIVE||!S.user){$('mfaStatus').textContent='Connect Supabase first.';$('startMfaBtn').disabled=true;return;}
  try{const [levels,factors]=await Promise.all([db.auth.mfa.getAuthenticatorAssuranceLevel(),db.auth.mfa.listFactors()]);
    if(levels.error)throw levels.error;if(factors.error)throw factors.error;
    const verified=(factors.data?.totp||[]).find(f=>f.status==='verified');S.mfaFactor=verified?.id||null;
    const level=levels.data?.currentLevel;
    $('mfaStatus').textContent=level==='aal2'?'MFA verified for this session. You can reveal encrypted credentials.':verified?'MFA enrolled. Verify the current login to reveal credentials.':'MFA is not enrolled. Set up an authenticator to enable password reveal.';
    $('startMfaBtn').classList.toggle('hidden',Boolean(verified));$('mfaVerify').classList.toggle('hidden',!verified||level==='aal2');
  }catch(e){$('mfaStatus').textContent='MFA status unavailable: '+errorMsg(e);}
}
async function startMfa(){try{
  const {data,error}=await db.auth.mfa.enroll({factorType:'totp',friendlyName:'SkyGate Desk'});if(error)throw error;
  S.enrollFactor=data.id;$('mfaQr').src=data.totp.qr_code;$('mfaEnroll').classList.remove('hidden');showMsg('mfaMsg','Scan the QR code with an authenticator app, then enter its 6-digit code.');
}catch(e){showMsg('mfaMsg',errorMsg(e),true);}}
async function verifyMfa(creating=false){try{const id=creating?S.enrollFactor:S.mfaFactor;
  if(!id)throw Error('No authenticator factor available.');const code=$(creating?'mfaEnrollCode':'mfaVerifyCode').value.trim();if(!/^\d{6}$/.test(code))throw Error('Enter a 6-digit authenticator code.');
  const {error}=await db.auth.mfa.challengeAndVerify({factorId:id,code});if(error)throw error;
  $('mfaEnroll').classList.add('hidden');$('mfaVerify').classList.add('hidden');showMsg('mfaMsg','MFA verified. Encrypted portal credentials may now be revealed.');await checkMfa();
}catch(e){showMsg('mfaMsg',errorMsg(e),true);}}

function delegateAction(e){const btn=e.target.closest('button[data-action]');if(!btn)return;
  const {action,id,account,kind}=btn.dataset;
  if(action==='chooseReceipt'||action==='useReceipt'){
    const c=byId(S.clients,id),a=byId(S.accounts,account);fillReceiptFromClient(c,a);openTab('receipt');
  }else if(action==='editClient')editClient(id);
  else if(action==='editIb')editIb(id);
  else if(action==='reveal')openVault(kind,id);
  else if(action==='history')openHistory(id);
}
function wireEvents(){
  document.querySelectorAll('.nav-btn').forEach(b=>b.addEventListener('click',()=>openTab(b.dataset.tab)));
  $('loginForm').addEventListener('submit',async e=>{e.preventDefault();showMsg('loginMsg','');const email=$('loginEmail').value.trim(),password=$('loginPass').value;
    try{const {data,error}=await db.auth.signInWithPassword({email,password});if(error)throw error;$('loginPass').value='';await signedIn(data.user);}catch(err){showMsg('loginMsg',errorMsg(err),true);}});
  $('logoutBtn').addEventListener('click',async()=>{if(IS_LIVE)await db.auth.signOut();S.user=null;S.clients=[];S.ibs=[];S.accounts=[];S.receipts=[];S.receipt=null;setView($('workspace'),false);setView($('loginView'),true);$('logoutBtn').classList.add('hidden');closeVault();});
  ['receiptAmountInput','receiptRate','receiptCurrency'].forEach(id=>$(id).addEventListener('input',updateConversion));
  $('saveRateBtn').addEventListener('click',saveRate);
  $('receiptForm').addEventListener('submit',e=>{e.preventDefault();generateReceipt();});
  $('receiptAccount').addEventListener('input',()=>{S.chosenAccount=null;S.chosenClient=null;});
  $('receiptSearch').addEventListener('input',()=>scheduleSearch('receiptSearch','receiptMatches'));
  $('enquirySearch').addEventListener('input',()=>scheduleSearch('enquirySearch','enquiryResults'));
  $('clientListSearch').addEventListener('input',()=>scheduleSearch('clientListSearch','clientList'));
  $('ibListSearch').addEventListener('input',()=>scheduleSearch('ibListSearch','ibList'));
  ['receiptMatches','enquiryResults','clientList','ibList','historyList'].forEach(id=>$(id).addEventListener('click',delegateAction));
  $('screenshotBtn').addEventListener('click',startScreenshot);$('screenshotTarget').addEventListener('click',endScreenshot);
  $('printBtn').addEventListener('click',()=>window.print());$('recordBtn').addEventListener('click',saveReceipt);
  $('addAccountBtn').addEventListener('click',()=>addAccountLine());$('clientForm').addEventListener('submit',saveClient);$('cancelClientEdit').addEventListener('click',resetClientForm);
  $('clientIbLookup').addEventListener('input',()=>{clearTimeout(debounceTimers.ib);debounceTimers.ib=setTimeout(suggestIB,210);});
  $('ibForm').addEventListener('submit',saveIb);$('cancelIbEdit').addEventListener('click',resetIbForm);
  $('closeVault').addEventListener('click',closeVault);$('passwordModal').addEventListener('click',e=>{if(e.target===$('passwordModal'))closeVault();});
  $('revealVaultBtn').addEventListener('click',revealVault);
  $('startMfaBtn').addEventListener('click',startMfa);$('verifyEnrollBtn').addEventListener('click',()=>verifyMfa(true));$('verifyMfaBtn').addEventListener('click',()=>verifyMfa(false));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('screenshotOverlay').classList.contains('hidden'))endScreenshot();else if(!$('passwordModal').classList.contains('hidden'))closeVault();}});
  resetClientForm();
}
start();
