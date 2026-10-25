'use strict';

const $ = id => document.getElementById(id);
const FIELDS_IB = 'id,ib_code,name,email,phone,trading_account_number,notes,created_at,updated_at';
const FIELDS_CLIENT = 'id,ib_id,full_name,email,phone,notes,created_at,updated_at';
const FIELDS_ACC = 'id,client_id,account_number,label,created_at';
const CONFIG = window.SKYGATE_CONFIG || {};
const IS_LIVE = Boolean(CONFIG.supabaseUrl && CONFIG.supabasePublishableKey && window.supabase?.createClient);
const db = IS_LIVE ? window.supabase.createClient(CONFIG.supabaseUrl,CONFIG.supabasePublishableKey) : null;

const S = {
  user:null,role:'',ibs:[],clients:[],accounts:[],rate:1500,
  rateUpdatedAt:null,receipt:null,chosenClient:null,chosenAccount:null,
  directorySequence:0,ibSequence:0,demoClientCounter:2
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
function formattedClientIb(client){const ib=S.ibs.find(i=>i.id===client.ib_id);return ib?`${ib.ib_code||'No IB number'} · ${ib.name||'Unnamed IB'}`:'No assigned IB';}
function labelClient(c){return c?.full_name?.trim() || `Unnamed client #${String(c?.id||'').slice(0,8)}`;}
function labelIb(i){return i?.name?.trim() || `Unnamed IB #${String(i?.id||'').slice(0,8)}`;}
function displayNotes(notes){return notes?`<div class="record-notes"><b>Notes</b><p>${escapeHtml(notes)}</p></div>`:'';}
function acctForClient(id){return S.accounts.filter(a=>a.client_id===id);}
function byId(collection,id){return collection.find(x=>x.id===id);}
function setView(el,show){el.classList.toggle('hidden',!show);}
function accountTags(arr){return `<div class="account-tags">${arr.length?arr.map(a=>`<span class="account-tag">MT5 ${escapeHtml(a.account_number)}</span>`).join(''):'<span class="meta">No linked MT5 accounts</span>'}</div>`;}
function lineMatch(t,value){return String(value??'').toLowerCase().includes(t.toLowerCase());}
function demoData(){
  S.ibs=[{id:'ib-demo-1',ib_code:'IB-100',name:'Example IB Partner',email:'ib@example.test',phone:'',trading_account_number:'991234',notes:'Demo IB note: regional partner.'}];
  S.clients=[{id:'client-demo-1',ib_id:'ib-demo-1',full_name:'Sample Client Ahmed',email:'sample@example.test',phone:'+9647000000000',notes:'Demo note: contact by phone in business hours.'},{id:'client-demo-2',ib_id:'ib-demo-1',full_name:'Sample Client Sara',email:'sara@example.test',phone:'+9647111111111',notes:null}];
  S.accounts=[{id:'acct-demo-1',client_id:'client-demo-1',account_number:'1315001'},{id:'acct-demo-2',client_id:'client-demo-1',account_number:'1315002'},{id:'acct-demo-3',client_id:'client-demo-2',account_number:'1499888'}];
  S.rate=1500;
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
  try { await refreshAll();}catch(e){toast('Database error: '+errorMsg(e));}
}
async function refreshAll(){
  if(!IS_LIVE){await redrawData();return;}
  const requests=[
    db.from('ibs').select(FIELDS_IB).order('name').limit(1000),
    db.from('clients').select(FIELDS_CLIENT).order('full_name').limit(1000),
    db.from('mt5_accounts').select(FIELDS_ACC).order('account_number').limit(1000),
    db.from('exchange_rates').select('id,iqd_per_usd,updated_at').eq('id',1).maybeSingle()
  ];
  const out=await Promise.all(requests);for(const r of out){if(r.error)throw r.error;}
  S.ibs=out[0].data||[];S.clients=out[1].data||[];S.accounts=out[2].data||[];
  S.rate=Number(out[3].data?.iqd_per_usd ?? 1500);S.rateUpdatedAt=out[3].data?.updated_at||null;
  $('receiptRate').value=S.rate;
  await redrawData();
}
async function redrawData(){
  fillIbOptions(S.ibs);renderClients(S.clients);renderIbs(S.ibs);updateConversion();renderSettingsRate();
}
function renderSettingsRate(){ $('settingsRate').textContent=`${fmtRate(S.rate)} IQD / USD`;
  $('rateMeta').textContent=S.rateUpdatedAt?`Saved in Supabase · ${dateIraq(S.rateUpdatedAt)}`:(IS_LIVE?'Rate not yet updated by staff. Confirm before real use.':'Demo rate. Connect Supabase to save across devices.');
}
// Navigation clears every unfinished form and search, but preserves the database-saved IQD rate.
function openTab(tab){
  const current=document.querySelector('.nav-btn.active')?.dataset.tab;
  if(current!==tab){
    resetReceiptForm();
    resetClientForm();
    resetIbForm();
    clearSearches();
  }
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.add('hidden'));
  $(`tab-${tab}`).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.tab===tab));
  if(tab==='enquiry'){scheduleSearch('enquirySearch','enquiryResults');}
  window.scrollTo({top:0,behavior:'smooth'});
}
function clearSearches(){
  S.directorySequence++;
  S.ibSequence++;
  Object.values(debounceTimers).forEach(clearTimeout);
  ['enquirySearch','clientListSearch','ibListSearch'].forEach(id=>$(id).value='');
  $('enquiryResults').innerHTML='';
  renderClients(S.clients);
  renderIbs(S.ibs);
}
function resetReceiptForm(){
  $('receiptForm').reset();
  // A locally edited but unsaved rate is discarded. The last saved rate survives navigation.
  $('receiptRate').value=String(S.rate);
  $('receiptSearch').value='';
  $('receiptMatches').innerHTML='';
  S.chosenClient=null;S.chosenAccount=null;S.receipt=null;
  $('receiptPlaceholder').classList.remove('hidden');
  $('receiptReady').classList.add('hidden');
  $('whatsappText').textContent='';
  showMsg('receiptMsg','');
  showMsg('copyMsg','');
  updateConversion();
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
  S.receipt=m;drawReceipt(m);showMsg('receiptMsg','Receipt prepared for screenshot and WhatsApp. Nothing is saved to the database.');
}
function drawReceipt(m){
  $('receiptPlaceholder').classList.add('hidden');$('receiptReady').classList.remove('hidden');
  $('rDate').textContent=dateIraq(m.created_at);
  $('rPrimary').textContent=m.source_currency==='USD'?formatUSD(m.amount_usd):formatIQD(m.amount_iqd);
  $('rSecondary').textContent=m.source_currency==='USD'?`Equivalent: ${formatIQD(m.amount_iqd)}`:`Equivalent: ${formatUSD(m.amount_usd)}`;
  $('rName').textContent=m.client_name_snapshot||'Not specified';$('rAccount').textContent=m.account_number;
  $('rUSD').textContent=formatUSD(m.amount_usd);$('rIQD').textContent=formatIQD(m.amount_iqd);
  $('rRate').textContent=`1 USD = ${fmtRate(m.exchange_rate)} IQD`;$('rRef').textContent=m.reference_code;
  // Generate the copyable WhatsApp message directly from this receipt's values.
  $('whatsappText').textContent=buildWhatsappMessage(m);
  showMsg('copyMsg','Not saved to the database. Copy the message, then take the screenshot.');
}
function formatWhatsappUSD(value){
  // 1000 -> 1000$, 1050.50 -> 1050.50$, exactly as requested (no currency commas).
  return Number(value).toFixed(2).replace(/\.00$/,'').replace(/(\.\d)0$/,'$1')+'$';
}
function buildWhatsappMessage(receipt){
  return `Deposit Iraq SkyGate LD\n${receipt.client_name_snapshot||'Not specified'}\n${receipt.account_number}\n${formatWhatsappUSD(receipt.amount_usd)}`;
}
async function copyWhatsappMessage(){
  if(!S.receipt)return;
  const value=buildWhatsappMessage(S.receipt);
  try{
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(value);
    }else{
      const temp=document.createElement('textarea');
      temp.value=value;temp.style.position='fixed';temp.style.opacity='0';
      document.body.appendChild(temp);temp.focus();temp.select();
      if(!document.execCommand('copy'))throw Error('Copy permission was denied.');
      temp.remove();
    }
    showMsg('copyMsg','WhatsApp text copied. Paste it into your group.');
    toast('WhatsApp request copied.');
  }catch(e){
    showMsg('copyMsg','Automatic copy was blocked. Select the text above to copy manually.',true);
  }
}
function startScreenshot(){
  const target=$('screenshotTarget');target.replaceChildren($('receiptCaptureArea'));
  setView($('screenshotOverlay'),true);document.body.style.overflow='hidden';
  window.scrollTo(0,0);
}
function endScreenshot(){
  $('receiptReady').insertBefore($('receiptCaptureArea'),$('receiptTools'));
  setView($('screenshotOverlay'),false);document.body.style.overflow='';
}

function sanitizeSearch(input){return String(input||'').trim().replace(/[%,()*]/g,'').slice(0,100);}
async function searchDirectory(term){
  const t=sanitizeSearch(term);
  if(!IS_LIVE){
    const matches=S.ibs.filter(i=>[i.name,i.ib_code,i.email,i.trading_account_number,i.notes].some(v=>lineMatch(t,v)));
    const clientIds=new Set(S.accounts.filter(a=>a.account_number.startsWith(t)).map(a=>a.client_id));
    const clients=S.clients.filter(c=>[c.full_name,c.email,c.phone,c.notes].some(v=>lineMatch(t,v)) || clientIds.has(c.id) || matches.some(i=>i.id===c.ib_id));
    return {clients,ibs:matches,accounts:S.accounts.filter(a=>clients.some(c=>c.id===a.client_id))};
  }
  // Each keystroke runs new parameterized Supabase queries; results are not limited to previously downloaded local records.
  const [ir,cr,ar]=await Promise.all([
    db.from('ibs').select(FIELDS_IB).or(`name.ilike.%${t}%,ib_code.ilike.${t}%,email.ilike.%${t}%,trading_account_number.ilike.${t}%,notes.ilike.%${t}%`).limit(25),
    db.from('clients').select(FIELDS_CLIENT).or(`full_name.ilike.%${t}%,email.ilike.%${t}%,phone.ilike.%${t}%,notes.ilike.%${t}%`).limit(35),
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
  for(const c of results.clients){const accounts=results.accounts.filter(a=>a.client_id===c.id);if(accounts.length){for(const a of accounts)all.push({c,a});}else all.push({c,a:null});}
  $('receiptMatches').innerHTML=all.length?all.slice(0,25).map(x=>`<button type="button" class="match-option" data-action="chooseReceipt" data-id="${escapeHtml(x.c.id)}" data-account="${escapeHtml(x.a?.id||'')}"><b>${escapeHtml(labelClient(x.c))}</b><small>${x.a?`MT5 ${escapeHtml(x.a.account_number)}`:'No linked MT5 — enter account manually'} · ${escapeHtml(formattedClientIb(x.c))}</small></button>`).join(''):'<div class="field-note">No registered match. You can enter the MT5 number manually below.</div>';
}
function renderClientCard(c,accounts){const ib=byId(S.ibs,c.ib_id);
  return `<article class="result-card"><div class="result-header"><div><h3>${escapeHtml(labelClient(c))}</h3><div class="meta">${escapeHtml(ib?`${ib.ib_code||'No IB number'} · ${labelIb(ib)}`:'Unassigned IB')}</div></div><span class="small-tag">Client</span></div>
  <p>${escapeHtml(c.email||'No email')} · ${escapeHtml(c.phone||'No phone')}</p>${accountTags(accounts)}${displayNotes(c.notes)}
  <div class="result-actions"><button type="button" data-action="editClient" data-id="${escapeHtml(c.id)}">Edit details</button>${accounts.length?`<button type="button" data-action="useReceipt" data-id="${escapeHtml(c.id)}" data-account="${escapeHtml(accounts[0].id)}">Generate receipt</button>`:''}</div></article>`;
}
function renderIbCard(i,clients){return `<article class="result-card"><div class="result-header"><div><h3>${escapeHtml(labelIb(i))}</h3><div class="meta">IB ${escapeHtml(i.ib_code||'Not assigned')} · Trading ${escapeHtml(i.trading_account_number||'—')}</div></div><span class="small-tag">${clients.length} clients</span></div><p>${escapeHtml(i.email||'No email')} ${i.phone?' · '+escapeHtml(i.phone):''}</p>${displayNotes(i.notes)}${clients.length?`<p><b>Clients:</b> ${escapeHtml(clients.map(c=>labelClient(c)).join(', '))}</p>`:''}<div class="result-actions"><button data-action="editIb" data-id="${escapeHtml(i.id)}" type="button">Edit IB</button></div></article>`;}
function renderClients(data){$('clientList').innerHTML=data.length?data.slice(0,60).map(c=>renderClientCard(c,acctForClient(c.id))).join(''):'<div class="empty-result">No clients found.</div>';}
function renderIbs(data){$('ibList').innerHTML=data.length?data.slice(0,60).map(i=>renderIbCard(i,S.clients.filter(c=>c.ib_id===i.id))).join(''):'<div class="empty-result">No IBs found.</div>';}
function renderEnquiry(data){const node=$('enquiryResults');const ibCards=data.ibs.map(i=>renderIbCard(i,data.clients.filter(c=>c.ib_id===i.id)));
  const clientCards=data.clients.map(c=>renderClientCard(c,data.accounts.filter(a=>a.client_id===c.id)));
  node.innerHTML=ibCards.join('')+clientCards.join('')||'<div class="empty-result">No matching clients or IBs. Try a different name or MT5 prefix.</div>';
}
function fillIbOptions(ibs){$('ibSuggestions').innerHTML=ibs.map(i=>`<option value="${escapeHtml(ibLabel(i))}"></option>`).join('');}
function ibLabel(i){return `${i.ib_code||'No IB number'} | ${labelIb(i)} | ${String(i.id).slice(0,8)}`;}
function pickIb(){const str=$('clientIbLookup').value.trim();if(!str)return null;const row=S.ibs.find(i=>ibLabel(i).toLowerCase()===str.toLowerCase());if(!row)throw Error('Select an IB from the suggestions, or leave the IB field empty.');return row.id;}
async function suggestIB(){const q=sanitizeSearch($('clientIbLookup').value);if(!IS_LIVE){fillIbOptions(S.ibs.filter(i=>[i.name,i.ib_code,i.email,i.trading_account_number,i.notes].some(x=>lineMatch(q,x))));return;}
  const token=++S.ibSequence;
  try{
    const {data,error}=await db.from('ibs').select(FIELDS_IB).or(`name.ilike.%${q}%,ib_code.ilike.${q}%,email.ilike.%${q}%,trading_account_number.ilike.${q}%,notes.ilike.%${q}%`).limit(40);
    if(error)throw error;if(token!==S.ibSequence)return;(data||[]).forEach(i=>mergeCache(S.ibs,i));fillIbOptions(data||[]);
  }catch(e){$('selectedIbNote').textContent=errorMsg(e);}
}
function addAccountLine(value='',locked=false){const el=document.createElement('div');el.className='account-line';
  const input=document.createElement('input');input.type='text';input.inputMode='numeric';input.maxLength=24;input.placeholder=locked?'Existing account':'MT5 account number';input.value=value;input.className='mt5-input';input.readOnly=locked;input.dataset.locked=String(locked);
  const btn=document.createElement('button');btn.type='button';btn.textContent=locked?'✓':'×';btn.disabled=locked;btn.setAttribute('aria-label','Remove account field');btn.addEventListener('click',()=>el.remove());el.append(input,btn);$('accountInputs').append(el);
}
function resetClientForm(){ $('clientForm').reset();$('editClientId').value='';$('clientFormTitle').textContent='Register client';$('clientSaveBtn').textContent='Register client';$('cancelClientEdit').classList.add('hidden');$('accountInputs').innerHTML='';addAccountLine();showMsg('clientMsg','');$('selectedIbNote').textContent='Select an existing IB, or leave empty if none.';}
function editClient(id){const c=byId(S.clients,id);if(!c)return;openTab('clients');resetClientForm();$('editClientId').value=c.id;$('clientFormTitle').textContent='Edit client';$('clientSaveBtn').textContent='Save changes';$('cancelClientEdit').classList.remove('hidden');$('clientFullName').value=c.full_name||'';$('clientNotes').value=c.notes||'';$('clientEmail').value=c.email||'';$('clientPhone').value=c.phone||'';const ib=byId(S.ibs,c.ib_id);$('clientIbLookup').value=ib?ibLabel(ib):'';$('accountInputs').innerHTML='';acctForClient(c.id).forEach(a=>addAccountLine(a.account_number,true));addAccountLine();window.scrollTo({top:0,behavior:'smooth'});}
function findDuplicateClient(email,phone,acctNums,exceptId=null){
  const cleanPhone=String(phone||'').replace(/\D/g,'');
  const dup=S.clients.find(c=>c.id!==exceptId && ((email && c.email?.trim().toLowerCase()===email.toLowerCase()) || (cleanPhone && String(c.phone||'').replace(/\D/g,'')===cleanPhone)));
  if(dup)return `Client already registered: ${labelClient(dup)}.`;
  const dupAcct=S.accounts.find(a=>acctNums.includes(a.account_number)&&a.client_id!==exceptId);
  if(dupAcct)return `Client already registered: MT5 account ${dupAcct.account_number} belongs to another client.`;
  return null;
}
function getMt5Form(){return [...$('accountInputs').querySelectorAll('input')].map(e=>({value:e.value.trim(),locked:e.dataset.locked==='true'})).filter(x=>x.value);}
async function saveClient(e){
  e.preventDefault();showMsg('clientMsg','');let savedId=null;
  try{
    const id=$('editClientId').value||null;
    const name=cleanText($('clientFullName').value);
    const email=cleanText($('clientEmail').value)?.toLowerCase()||null;
    const phone=cleanText($('clientPhone').value);
    const notes=cleanText($('clientNotes').value);
    const ib_id=pickIb();
    const lines=getMt5Form(),accounts=lines.map(x=>x.value);
    const newAccounts=lines.filter(x=>!x.locked).map(x=>x.value);
    if(accounts.some(a=>!/^[0-9]{4,24}$/.test(a)))throw Error('Entered MT5 numbers must contain 4–24 digits. Empty is allowed.');
    if(new Set(accounts).size!==accounts.length)throw Error('Client already registered: duplicate MT5 number in this form.');
    const dup=findDuplicateClient(email,phone,accounts,id);if(dup)throw Error(dup);
    if(IS_LIVE){
      if(id){
        const changes={full_name:name,email,phone,ib_id,notes,updated_at:new Date().toISOString()};
        const result=await db.from('clients').update(changes).eq('id',id);
        if(result.error)throw result.error;
        if(newAccounts.length){
          const r=await db.from('mt5_accounts').insert(newAccounts.map(account_number=>({account_number,client_id:id})));
          if(r.error)throw r.error;
        }
        savedId=id;
      }else{
        const {data,error}=await db.rpc('register_client',{
          p_full_name:name,p_email:email,p_phone:phone,p_ib_id:ib_id,
          p_mt5_numbers:accounts,p_notes:notes
        });
        if(error)throw error;
        savedId=data;
      }
      await refreshAll();
    }else{
      if(id){
        Object.assign(byId(S.clients,id),{full_name:name,email,phone,ib_id,notes});
        newAccounts.forEach(account_number=>S.accounts.push({id:`acct-demo-${Date.now()}-${Math.random()}`,client_id:id,account_number}));savedId=id;
      }else{
        savedId=`client-demo-${++S.demoClientCounter}`;
        S.clients.push({id:savedId,full_name:name,email,phone,ib_id,notes});
        accounts.forEach(account_number=>S.accounts.push({id:`acct-demo-${Date.now()}-${Math.random()}`,client_id:savedId,account_number}));
      }
      await redrawData();
    }
    resetClientForm();showMsg('clientMsg',`Client saved successfully${IS_LIVE?' in Supabase':' in demo memory'} (${savedId}).`);toast('Client saved.');
  }catch(err){showMsg('clientMsg',errorMsg(err),true);}
}
function resetIbForm(){$('ibForm').reset();$('editIbId').value='';$('ibFormTitle').textContent='Add introducing broker';$('ibSaveBtn').textContent='Save IB';$('cancelIbEdit').classList.add('hidden');showMsg('ibMsg','');}
function editIb(id){const i=byId(S.ibs,id);if(!i)return;openTab('ibs');resetIbForm();$('editIbId').value=i.id;$('ibFormTitle').textContent='Edit introducing broker';$('ibSaveBtn').textContent='Save changes';$('cancelIbEdit').classList.remove('hidden');$('ibCode').value=i.ib_code||'';$('ibName').value=i.name||'';$('ibNotes').value=i.notes||'';$('ibEmail').value=i.email||'';$('ibPhone').value=i.phone||'';$('ibTradingAccount').value=i.trading_account_number||'';window.scrollTo({top:0,behavior:'smooth'});}
async function saveIb(e){
  e.preventDefault();showMsg('ibMsg','');
  try{
    const id=$('editIbId').value||null;
    const ib_code=cleanText($('ibCode').value);
    const name=cleanText($('ibName').value);
    const email=cleanText($('ibEmail').value)?.toLowerCase()||null;
    const phone=cleanText($('ibPhone').value);
    const trading_account_number=cleanText($('ibTradingAccount').value);
    const notes=cleanText($('ibNotes').value);
    if(trading_account_number&&!/^[0-9]{4,24}$/.test(trading_account_number))throw Error('Entered IB trading account must have 4–24 digits. Empty is allowed.');
    if(S.ibs.some(i=>i.id!==id&&(
      (ib_code&&i.ib_code?.toLowerCase()===ib_code.toLowerCase()) ||
      (email&&i.email?.toLowerCase()===email) ||
      (trading_account_number&&i.trading_account_number===trading_account_number)
    )))throw Error('IB already registered (same number, email or trading account).');
    const values={ib_code,name,email,phone,trading_account_number,notes};
    if(IS_LIVE){
      const r=id?await db.from('ibs').update({...values,updated_at:new Date().toISOString()}).eq('id',id):await db.from('ibs').insert(values);
      if(r.error)throw r.error;await refreshAll();
    }else{
      if(id)Object.assign(byId(S.ibs,id),values);
      else S.ibs.push({...values,id:`ib-demo-${Date.now()}`});
      await redrawData();
    }
    resetIbForm();showMsg('ibMsg','IB saved successfully.');toast('IB saved.');
  }catch(err){showMsg('ibMsg',errorMsg(err),true);}
}

function delegateAction(e){const btn=e.target.closest('button[data-action]');if(!btn)return;
  const {action,id,account}=btn.dataset;
  if(action==='chooseReceipt'||action==='useReceipt'){
    const c=byId(S.clients,id),a=byId(S.accounts,account);openTab('receipt');fillReceiptFromClient(c,a);
  }else if(action==='editClient')editClient(id);
  else if(action==='editIb')editIb(id);
}
function wireEvents(){
  document.querySelectorAll('.nav-btn').forEach(b=>b.addEventListener('click',()=>openTab(b.dataset.tab)));
  $('loginForm').addEventListener('submit',async e=>{e.preventDefault();showMsg('loginMsg','');const email=$('loginEmail').value.trim(),password=$('loginPass').value;
    try{const {data,error}=await db.auth.signInWithPassword({email,password});if(error)throw error;$('loginPass').value='';await signedIn(data.user);}catch(err){showMsg('loginMsg',errorMsg(err),true);}});
  $('logoutBtn').addEventListener('click',async()=>{if(IS_LIVE)await db.auth.signOut();S.user=null;S.clients=[];S.ibs=[];S.accounts=[];S.receipt=null;setView($('workspace'),false);setView($('loginView'),true);$('logoutBtn').classList.add('hidden');});
  ['receiptAmountInput','receiptRate','receiptCurrency'].forEach(id=>$(id).addEventListener('input',updateConversion));
  $('saveRateBtn').addEventListener('click',saveRate);
  $('receiptForm').addEventListener('submit',e=>{e.preventDefault();generateReceipt();});
  $('receiptAccount').addEventListener('input',()=>{S.chosenAccount=null;S.chosenClient=null;});
  $('receiptSearch').addEventListener('input',()=>scheduleSearch('receiptSearch','receiptMatches'));
  $('enquirySearch').addEventListener('input',()=>scheduleSearch('enquirySearch','enquiryResults'));
  $('clientListSearch').addEventListener('input',()=>scheduleSearch('clientListSearch','clientList'));
  $('ibListSearch').addEventListener('input',()=>scheduleSearch('ibListSearch','ibList'));
  ['receiptMatches','enquiryResults','clientList','ibList'].forEach(id=>$(id).addEventListener('click',delegateAction));
  $('screenshotBtn').addEventListener('click',startScreenshot);$('screenshotTarget').addEventListener('click',endScreenshot);
  $('printBtn').addEventListener('click',()=>window.print());
  $('copyWhatsappBtn').addEventListener('click',copyWhatsappMessage);
  $('clearReceiptBtn').addEventListener('click',resetReceiptForm);
  $('clearEnquiryBtn').addEventListener('click',()=>{ $('enquirySearch').value='';scheduleSearch('enquirySearch','enquiryResults'); });
  $('clearClientBtn').addEventListener('click',resetClientForm);
  $('clearIbBtn').addEventListener('click',resetIbForm);
  $('addAccountBtn').addEventListener('click',()=>addAccountLine());$('clientForm').addEventListener('submit',saveClient);$('cancelClientEdit').addEventListener('click',resetClientForm);
  $('clientIbLookup').addEventListener('input',()=>{clearTimeout(debounceTimers.ib);debounceTimers.ib=setTimeout(suggestIB,210);});
  $('ibForm').addEventListener('submit',saveIb);$('cancelIbEdit').addEventListener('click',resetIbForm);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('screenshotOverlay').classList.contains('hidden'))endScreenshot();});
  resetClientForm();
}
start();
