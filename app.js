'use strict';

const $ = id => document.getElementById(id);
const NEEX_PORTAL_URL = 'https://cp.neex.com/login/index?redirect=/';
const FIELDS_IB = 'id,ib_code,name,email,phone,trading_account_number,spread_26,spread_36,spread_26_url,spread_36_url,notes,created_at,updated_at';
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
function displayNotes(notes,recordType,recordId){
  if(!notes)return '';
  return `<div class="record-notes"><div class="record-notes-heading"><b>Notes</b><button type="button" class="copy-note-btn" data-action="copyRecordNote" data-kind="${recordType}" data-id="${escapeHtml(recordId)}" aria-label="Copy ${recordType} note">Copy</button></div><p>${escapeHtml(notes)}</p></div>`;
}
function acctForClient(id){return S.accounts.filter(a=>a.client_id===id);}
function byId(collection,id){return collection.find(x=>x.id===id);}
function setView(el,show){el.classList.toggle('hidden',!show);}
// Enquiry and search cards are read-only; deleting saved accounts is only available in Edit details.
function accountTags(arr){
  return `<div class="account-tags">${arr.length?arr.map(a=>`<span class="account-tag">MT5 ${escapeHtml(a.account_number)}</span>`).join(''):'<span class="meta">No linked MT5 accounts</span>'}</div>`;
}
function canDeleteMt5(){return !IS_LIVE || S.role==='admin';}
function lineMatch(t,value){return String(value??'').toLowerCase().includes(t.toLowerCase());}
function demoData(){
  S.ibs=[{id:'ib-demo-1',ib_code:'IB-100',name:'Example IB Partner',email:'ib@example.test',phone:'',trading_account_number:'991234',spread_26:true,spread_36:true,spread_26_url:'https://example.test/ib26',spread_36_url:'https://example.test/ib36',notes:'Demo IB note: regional partner.'}];
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
  preparedReceiptFile=null;preparedReceiptPromise=null;
  const shareButton=$('shareReceiptBtn');shareButton.disabled=true;shareButton.textContent='Generate receipt first';
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
  S.receipt=m;drawReceipt(m);prepareReceiptImage(m);showMsg('receiptMsg','Receipt generated. Share it on WhatsApp; nothing is saved to the database.');
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
  showMsg('copyMsg','Your WhatsApp message is ready. Use Save & Share to send the receipt image.');
}
function formatWhatsappUSD(value){
  // 1000 -> 1000$, 1050.50 -> 1050.50$, exactly as requested (no currency commas).
  return Number(value).toFixed(2).replace(/\.00$/,'').replace(/(\.\d)0$/,'$1')+'$';
}
function buildWhatsappMessage(receipt){
  const fullName = String(receipt.client_name_snapshot || '').trim();
  const firstName = fullName ? fullName.split(/\s+/)[0] : 'Not specified';
  return `Deposit Iraq SkyGate LD\n${firstName}\n${receipt.account_number}\n${formatWhatsappUSD(receipt.amount_usd)}`;
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
// A real PNG is generated with browser Canvas, including both brand logos.
// This avoids unreliable DOM screenshots in iOS Safari and requires no external library.
let preparedReceiptFile=null;
let preparedReceiptPromise=null;

function loadShareImage(src){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=()=>reject(new Error(`Could not load ${src}. Make sure you uploaded the assets folder.`));
    img.src=src;
  });
}
function shareRoundRect(ctx,x,y,w,h,r,fill){
  ctx.fillStyle=fill;
  ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();
}
function shareText(ctx,value,x,y,{size=30,bold=false,color='#173b55',align='left',maxWidth=900}={}){
  ctx.fillStyle=color;
  ctx.textAlign=align;
  ctx.textBaseline='alphabetic';
  ctx.font=`${bold?'700':'400'} ${size}px -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif`;
  ctx.fillText(String(value),x,y,maxWidth);
}
function renderReceiptCanvas(m,skyImg,neexImg){
  const canvas=document.createElement('canvas');
  canvas.width=1080;canvas.height=1370;
  const c=canvas.getContext('2d');
  if(!c)throw new Error('Image rendering is not supported in this browser.');
  c.fillStyle='#ffffff';c.fillRect(0,0,1080,1370);
  const gradient=c.createLinearGradient(75,0,1005,0);
  gradient.addColorStop(0,'#154568');gradient.addColorStop(.55,'#3894c9');gradient.addColorStop(1,'#65c6cf');
  shareRoundRect(c,72,28,936,27,13,gradient);
  // Keep logos on white, as in the on-screen deposit request.
  const skyHeight=112, skyWidth=112*skyImg.width/skyImg.height;
  c.drawImage(skyImg,86,86,skyWidth,skyHeight);
  shareText(c,'SKYGATE',86+skyWidth+22,135,{size:33,bold:true});
  shareText(c,'T E C H N O L O G Y',86+skyWidth+22,161,{size:15,bold:true,color:'#56768b'});
  const neexHeight=94,neexWidth=94*neexImg.width/neexImg.height;
  c.drawImage(neexImg,980-neexWidth,89,neexWidth,neexHeight);
  shareText(c,'SKYGATE TECHNOLOGY  ·  DEPOSIT REQUEST',88,249,{size:24,bold:true,color:'#3b8fb7'});
  shareText(c,'Deposit request',88,322,{size:55,bold:true,color:'#173b55'});
  shareText(c,dateIraq(m.created_at),88,378,{size:30,color:'#7c94a8'});
  shareRoundRect(c,88,420,904,256,24,'#eaf5fb');
  c.strokeStyle='#cde4f1';c.lineWidth=2;c.strokeRect(91,423,898,250);
  shareText(c,'REQUESTED DEPOSIT',540,478,{size:25,bold:true,color:'#6394b0',align:'center'});
  const primary=m.source_currency==='USD'?formatUSD(m.amount_usd):formatIQD(m.amount_iqd);
  const secondary=m.source_currency==='USD'?`Equivalent: ${formatIQD(m.amount_iqd)}`:`Equivalent: ${formatUSD(m.amount_usd)}`;
  shareText(c,primary,540,566,{size:68,bold:true,align:'center',maxWidth:815});
  shareText(c,secondary,540,630,{size:32,color:'#63829a',align:'center'});
  const rows=[
    ['Client',m.client_name_snapshot||'Not specified'],
    ['MT5 account',m.account_number],
    ['Amount USD',formatUSD(m.amount_usd)],
    ['Amount IQD',formatIQD(m.amount_iqd)],
    ['Exchange rate',`1 USD = ${fmtRate(m.exchange_rate)} IQD`],
    ['Reference',m.reference_code]
  ];
  let y=749;
  for(const [label,value] of rows){
    shareText(c,label,88,y,{size:31,color:'#748fa2'});
    shareText(c,value,995,y,{size:31,bold:true,color:'#173b55',align:'right',maxWidth:550});
    c.strokeStyle='#dce7ee';c.lineWidth=2;c.beginPath();c.moveTo(88,y+25);c.lineTo(992,y+25);c.stroke();
    y+=91;
  }
  c.strokeStyle='#dce7ee';c.beginPath();c.moveTo(88,1249);c.lineTo(992,1249);c.stroke();
  shareText(c,'Prepared by SkyGate Technology',88,1293,{size:27,bold:true,color:'#3e6d88'});
  shareText(c,'Deposit request for processing; not a confirmation of NEEX account credit.',88,1332,{size:23,color:'#7993a5',maxWidth:900});
  return canvas;
}
function pngFileFromCanvas(canvas,receipt){
  const uri=canvas.toDataURL('image/png');
  const binary=atob(uri.split(',')[1]);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  const safeAccount=String(receipt.account_number).replace(/[^0-9]/g,'');
  return new File([bytes],`SkyGate_Deposit_${safeAccount}.png`,{type:'image/png'});
}
function prepareReceiptImage(receipt){
  preparedReceiptFile=null;
  const button=$('shareReceiptBtn');
  button.disabled=true;button.textContent='Preparing receipt image…';
  preparedReceiptPromise=Promise.all([
    loadShareImage('assets/skygate.png'),
    loadShareImage('assets/neex.png')
  ]).then(([skyImg,neexImg])=>{
    const file=pngFileFromCanvas(renderReceiptCanvas(receipt,skyImg,neexImg),receipt);
    if(S.receipt!==receipt)return null;
    preparedReceiptFile=file;
    button.disabled=false;button.textContent='Save & Share on WhatsApp';
    return file;
  }).catch(error=>{
    if(S.receipt!==receipt)return null;
    button.disabled=false;button.textContent='Save & Share on WhatsApp';
    showMsg('copyMsg',`Could not prepare receipt image: ${error.message}`,true);
    return null;
  });
}
function copyWhatsappOnShare(text){
  // First try a synchronous copy in the actual user click, preserving the user
  // gesture for the native share sheet. iPhone may still deny clipboard access.
  try{
    const area=document.createElement('textarea');
    area.value=text;
    area.readOnly=true;
    area.style.cssText='position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(area);
    area.focus();area.select();area.setSelectionRange(0,area.value.length);
    const ok=document.execCommand('copy');
    area.remove();
    if(ok)return true;
  }catch(_){ /* Clipboard is optional; user can use Copy message button */ }
  if(navigator.clipboard?.writeText){
    navigator.clipboard.writeText(text).catch(()=>{});
  }
  return false;
}
function downloadReceiptImage(file){
  const link=document.createElement('a');
  const url=URL.createObjectURL(file);
  link.href=url;link.download=file.name;
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),120000);
}
async function shareReceiptOnWhatsapp(){
  const receipt=S.receipt;
  if(!receipt)return;
  const text=buildWhatsappMessage(receipt);
  const file=preparedReceiptFile;
  if(!file){
    showMsg('copyMsg','Image is not ready. Generate the receipt again, or try again after the image is prepared.',true);
    return;
  }
  const copied=copyWhatsappOnShare(text);
  // iOS Safari: native Share Sheet can show WhatsApp and Save Image. It cannot
  // auto-save to Photos or force-select WhatsApp for security reasons.
  if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){
    try{
      await navigator.share({files:[file],text,title:'SkyGate deposit request'});
      showMsg('copyMsg',copied?'Receipt shared. WhatsApp request copied; paste if the caption is missing.':'Receipt shared. The message was included in the Share Sheet; use Copy message if WhatsApp omitted it.');
      return;
    }catch(error){
      if(error?.name==='AbortError'){
        showMsg('copyMsg','Sharing cancelled. Tap Save & Share to try again.');
        return;
      }
      // Some apps or browsers do not accept a file and text together.
      try{
        await navigator.share({files:[file],title:'SkyGate deposit request'});
        showMsg('copyMsg','Photo shared. Tap Copy message if it was not copied automatically.');
        return;
      }catch(_){ /* Fall through to image download */ }
    }
  }
  downloadReceiptImage(file);
  showMsg('copyMsg','Your browser downloaded the receipt PNG. Open it in Photos or Files and share to WhatsApp. Use Copy message to copy the request.');
  toast('Receipt image prepared.');
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
function portalButton(email){
  // The email is copied on user action. NEEX is a separate origin, so this
  // website cannot fill its login fields or interact with its CAPTCHA.
  return `<button type="button" data-action="goToPortal" data-email="${escapeHtml(email||'')}">Go to portal</button>`;
}
function copyPortalEmail(email){
  if(!email)return Promise.resolve(true);
  if(navigator.clipboard?.writeText){
    return navigator.clipboard.writeText(email).then(()=>true).catch(()=>copyPortalEmailFallback(email));
  }
  return Promise.resolve(copyPortalEmailFallback(email));
}
function copyPortalEmailFallback(email){
  const temp=document.createElement('textarea');
  temp.value=email;
  temp.style.position='fixed';temp.style.opacity='0';
  document.body.appendChild(temp);temp.focus();temp.select();
  let ok=false;
  try{ok=document.execCommand('copy');}catch(e){ok=false;}
  temp.remove();
  return ok;
}
async function goToPortal(email){
  const address=String(email||'').trim();
  const copied=await copyPortalEmail(address);
  if(address && !copied){
    toast('Email could not be copied. Copy it from the search result and try again.');
    return;
  }
  // Navigate directly to the official portal; the user fills the password
  // with a password manager and completes any CAPTCHA on NEEX itself.
  window.location.assign(NEEX_PORTAL_URL);
}
function renderClientCard(c,accounts){const ib=byId(S.ibs,c.ib_id);
  return `<article class="result-card"><div class="result-header"><div><h3>${escapeHtml(labelClient(c))}</h3><div class="meta">${escapeHtml(ib?`${ib.ib_code||'No IB number'} · ${labelIb(ib)}`:'Unassigned IB')}</div></div><span class="small-tag">Client</span></div>
  <p>${escapeHtml(c.email||'No email')} · ${escapeHtml(c.phone||'No phone')}</p>${accountTags(accounts)}${displayNotes(c.notes,'client',c.id)}
  <div class="result-actions"><button type="button" data-action="editClient" data-id="${escapeHtml(c.id)}">Edit details</button>${accounts.length?`<button type="button" data-action="useReceipt" data-id="${escapeHtml(c.id)}" data-account="${escapeHtml(accounts[0].id)}">Generate receipt</button>`:''}${portalButton(c.email)}</div></article>`;
}
function renderIbSpreadDetails(i){
  const enabled=[];
  if(i.spread_26)enabled.push('Spread 26');
  if(i.spread_36)enabled.push('Spread 36');
  const chips=enabled.length?enabled.map(s=>`<span class="ib-spread-badge">${s}</span>`).join(''):'<span class="meta">Spreads not assigned</span>';
  const links=[[26,i.spread_26,i.spread_26_url],[36,i.spread_36,i.spread_36_url]].filter(x=>x[1]&&x[2]).map(x=>[x[0],x[2]]);
  const linksHtml=links.length?`<div class="ib-link-list">${links.map(([spread,url])=>`<div class="ib-link-row"><div class="ib-link-description"><strong>Spread ${spread} IB link</strong><span title="${escapeHtml(url)}">${escapeHtml(url)}</span></div><button type="button" data-action="copyIbSpreadLink" data-id="${escapeHtml(i.id)}" data-spread="${spread}" aria-label="Copy Spread ${spread} link">Copy</button></div>`).join('')}</div>`:'';
  return `<div class="ib-spread-details">${chips}</div>${linksHtml}`;
}
function renderIbCard(i,clients){return `<article class="result-card"><div class="result-header"><div><h3>${escapeHtml(labelIb(i))}</h3><div class="meta">IB ${escapeHtml(i.ib_code||'Not assigned')} · Trading ${escapeHtml(i.trading_account_number||'—')}</div></div><span class="small-tag">${clients.length} clients</span></div><p>${escapeHtml(i.email||'No email')} ${i.phone?' · '+escapeHtml(i.phone):''}</p>${renderIbSpreadDetails(i)}${displayNotes(i.notes,'ib',i.id)}${clients.length?`<p><b>Clients:</b> ${escapeHtml(clients.map(c=>labelClient(c)).join(', '))}</p>`:''}<div class="result-actions"><button data-action="editIb" data-id="${escapeHtml(i.id)}" type="button">Edit IB</button><button data-action="useIbReceipt" data-id="${escapeHtml(i.id)}" type="button">Generate receipt</button>${portalButton(i.email)}</div></article>`;}
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
function addAccountLine(value='',locked=false,accountId=''){
  const el=document.createElement('div');el.className='account-line';
  const input=document.createElement('input');input.type='text';input.inputMode='numeric';input.maxLength=24;
  input.placeholder=locked?'Existing account':'MT5 account number';input.value=value;input.className='mt5-input';
  input.readOnly=locked;input.dataset.locked=String(locked);
  const btn=document.createElement('button');btn.type='button';btn.textContent='×';
  btn.setAttribute('aria-label',locked?'Delete MT5 account '+value:'Remove unsaved account field');
  if(locked){
    btn.className='mt5-form-delete';btn.title='Delete saved MT5 account';btn.disabled=!canDeleteMt5();
    btn.addEventListener('click',()=>askDeleteMt5(accountId));
    el.dataset.accountId=accountId;
  }else{btn.addEventListener('click',()=>el.remove());}
  el.append(input,btn);$('accountInputs').append(el);
}

// An MT5 account can only be permanently deleted through the Supabase RPC.
// The PIN is verified server-side, not in this publicly hosted JavaScript.
let pendingDeleteAccountId=null;
function askDeleteMt5(accountId){
  const acct=byId(S.accounts,accountId);
  // Even if a stale UI element is clicked, restrict the dialog to the current edit form.
  if(!acct || !canDeleteMt5() || !$('editClientId').value ||
      acct.client_id!==$('editClientId').value ||
      !document.querySelector('.nav-btn.active[data-tab="clients"]') ||
      !$('accountInputs').querySelector(`.account-line[data-account-id="${accountId}"]`))return;
  pendingDeleteAccountId=accountId;
  $('mt5DeleteNumber').textContent=acct.account_number;
  $('mt5DeletePin').value='';
  showMsg('mt5DeleteMsg','');
  $('mt5DeleteConfirm').disabled=false;
  const dlg=$('mt5DeleteDialog');
  if(typeof dlg.showModal==='function')dlg.showModal();
  else dlg.setAttribute('open','');
  $('mt5DeletePin').focus();
}
function closeDeleteMt5(){
  const dlg=$('mt5DeleteDialog');
  if(typeof dlg.close==='function' && dlg.open)dlg.close();
  else dlg.removeAttribute('open');
  $('mt5DeletePin').value='';
  pendingDeleteAccountId=null;
  showMsg('mt5DeleteMsg','');
}
async function submitDeleteMt5(e){
  e.preventDefault();
  const accountId=pendingDeleteAccountId;
  const pin=$('mt5DeletePin').value.trim();
  if(!accountId)return;
  if(!/^\d{4}$/.test(pin)){
    showMsg('mt5DeleteMsg','Enter the 4-digit deletion PIN.',true);return;
  }
  const btn=$('mt5DeleteConfirm');btn.disabled=true;
  try{
    if(IS_LIVE){
      const {data,error}=await db.rpc('delete_mt5_account_with_pin',{
        p_account_id:accountId,p_pin:pin
      });
      if(error)throw error;
      if(!data?.ok){
        const msgs={wrong_pin:'Incorrect PIN. Please try again.',
          not_found:'This MT5 account no longer exists. Refresh the records.'};
        throw Error(msgs[data?.code]||'Unable to delete this MT5 account.');
      }
    }else{
      // Fictional demo records only. Live deletion PIN validation happens in Supabase.
      if(pin!=='1122')throw Error('Incorrect demo PIN.');
      S.accounts=S.accounts.filter(a=>a.id!==accountId);
    }
    // Remove the deleted account from all page views and any open edit form.
    S.accounts=S.accounts.filter(a=>a.id!==accountId);
    $('accountInputs').querySelectorAll('.account-line[data-account-id]').forEach(el=>{
      if(el.dataset.accountId===accountId)el.remove();
    });
    if(S.chosenAccount?.id===accountId){
      S.chosenAccount=null;
      S.chosenClient=null;
      $('receiptAccount').value='';
    }
    closeDeleteMt5();
    if(IS_LIVE)await refreshAll();else await redrawData();
    toast('MT5 account deleted successfully'+(IS_LIVE?' from Supabase.':' (demo only).'));
  }catch(err){showMsg('mt5DeleteMsg',errorMsg(err),true);}
  finally{btn.disabled=false;}
}
function resetClientForm(){ $('clientForm').reset();$('editClientId').value='';$('clientFormTitle').textContent='Register client';$('clientSaveBtn').textContent='Register client';$('cancelClientEdit').classList.add('hidden');$('accountInputs').innerHTML='';addAccountLine();showMsg('clientMsg','');$('selectedIbNote').textContent='Select an existing IB, or leave empty if none.';}
function editClient(id){const c=byId(S.clients,id);if(!c)return;openTab('clients');resetClientForm();$('editClientId').value=c.id;$('clientFormTitle').textContent='Edit client';$('clientSaveBtn').textContent='Save changes';$('cancelClientEdit').classList.remove('hidden');$('clientFullName').value=c.full_name||'';$('clientNotes').value=c.notes||'';$('clientEmail').value=c.email||'';$('clientPhone').value=c.phone||'';const ib=byId(S.ibs,c.ib_id);$('clientIbLookup').value=ib?ibLabel(ib):'';$('accountInputs').innerHTML='';acctForClient(c.id).forEach(a=>addAccountLine(a.account_number,true,a.id));addAccountLine();window.scrollTo({top:0,behavior:'smooth'});}
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
function updateIbLinkCopyButtons(){
  $('copyIbSpread26Btn').disabled=!$('ibSpread26Url').value.trim();
  $('copyIbSpread36Btn').disabled=!$('ibSpread36Url').value.trim();
}
function copyTextFallback(value){
  const el=document.createElement('textarea');
  el.value=value;el.setAttribute('readonly','');el.style.position='fixed';el.style.opacity='0';
  document.body.appendChild(el);el.select();let ok=false;
  try{ok=document.execCommand('copy');}catch(_){ok=false;}
  el.remove();return ok;
}
async function copyIbLink(url){
  if(!url){toast('No link saved for this spread.');return;}
  let ok=false;
  if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(url);ok=true;}catch(_){}}
  if(!ok)ok=copyTextFallback(url);
  toast(ok?'IB link copied.':'Could not copy the link. Please select and copy it manually.');
}
async function copyRecordNote(kind,id){
  const record=kind==='client'?byId(S.clients,id):kind==='ib'?byId(S.ibs,id):null;
  const note=record?.notes;
  if(!note){toast('No note available to copy.');return;}
  let copied=false;
  if(navigator.clipboard?.writeText){
    try{await navigator.clipboard.writeText(note);copied=true;}catch(_){}
  }
  if(!copied)copied=copyTextFallback(note);
  toast(copied?'Note copied.':'Could not copy note. Select the note text to copy manually.');
}
function resetIbForm(){$('ibForm').reset();$('editIbId').value='';$('ibFormTitle').textContent='Add introducing broker';$('ibSaveBtn').textContent='Save IB';$('cancelIbEdit').classList.add('hidden');showMsg('ibMsg','');updateIbLinkCopyButtons();}
function editIb(id){const i=byId(S.ibs,id);if(!i)return;openTab('ibs');resetIbForm();$('editIbId').value=i.id;$('ibFormTitle').textContent='Edit introducing broker';$('ibSaveBtn').textContent='Save changes';$('cancelIbEdit').classList.remove('hidden');$('ibCode').value=i.ib_code||'';$('ibName').value=i.name||'';$('ibNotes').value=i.notes||'';$('ibEmail').value=i.email||'';$('ibPhone').value=i.phone||'';$('ibTradingAccount').value=i.trading_account_number||'';$('ibSpread26').checked=Boolean(i.spread_26);$('ibSpread36').checked=Boolean(i.spread_36);$('ibSpread26Url').value=i.spread_26_url||'';$('ibSpread36Url').value=i.spread_36_url||'';updateIbLinkCopyButtons();window.scrollTo({top:0,behavior:'smooth'});}
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
    const spread_26=$('ibSpread26').checked;
    const spread_36=$('ibSpread36').checked;
    const spread_26_url=cleanText($('ibSpread26Url').value);
    const spread_36_url=cleanText($('ibSpread36Url').value);
    for(const [type,url] of [[26,spread_26_url],[36,spread_36_url]]){
      if(url){
        let parsed;
        try{parsed=new URL(url);}catch(_){throw Error(`Spread ${type} IB link must be a valid HTTP or HTTPS URL.`);}
        if(!['https:','http:'].includes(parsed.protocol)||!parsed.hostname||parsed.username||parsed.password){
          throw Error(`Spread ${type} IB link must be a valid HTTP or HTTPS URL without embedded credentials.`);
        }
      }
    }
    if(trading_account_number&&!/^[0-9]{4,24}$/.test(trading_account_number))throw Error('Entered IB trading account must have 4–24 digits. Empty is allowed.');
    if(S.ibs.some(i=>i.id!==id&&(
      (ib_code&&i.ib_code?.toLowerCase()===ib_code.toLowerCase()) ||
      (email&&i.email?.toLowerCase()===email) ||
      (trading_account_number&&i.trading_account_number===trading_account_number)
    )))throw Error('IB already registered (same number, email or trading account).');
    const values={ib_code,name,email,phone,trading_account_number,spread_26,spread_36,spread_26_url,spread_36_url,notes};
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
  }else if(action==='useIbReceipt'){
    const ib=byId(S.ibs,id);
    if(!ib)return;
    openTab('receipt');
    S.chosenClient=null;S.chosenAccount=null;
    $('receiptName').value=ib.name||ib.ib_code||'';
    // The receipt requires a numeric trading account. IB numbers can be alphanumeric.
    const accountNumber=String(ib.trading_account_number||'').trim();
    $('receiptAccount').value=/^\d{4,24}$/.test(accountNumber)?accountNumber:'';
    $('receiptSearch').value='';
    $('receiptMatches').innerHTML='';
    if(!$('receiptAccount').value)showMsg('receiptMsg','IB selected. Enter its numeric trading account number to generate a receipt.');
  }else if(action==='copyRecordNote'){
    void copyRecordNote(btn.dataset.kind,id);
  }else if(action==='copyIbSpreadLink'){
    const ib=byId(S.ibs,id);const spread=btn.dataset.spread;
    if(!ib||!['26','36'].includes(spread))return;
    void copyIbLink(spread==='26'?ib.spread_26_url:ib.spread_36_url);
  }else if(action==='goToPortal'){
    void goToPortal(btn.dataset.email||'');
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
  $('shareReceiptBtn').addEventListener('click',shareReceiptOnWhatsapp);
  $('printBtn').addEventListener('click',()=>window.print());
  $('copyWhatsappBtn').addEventListener('click',copyWhatsappMessage);
  $('clearReceiptBtn').addEventListener('click',resetReceiptForm);
  $('clearEnquiryBtn').addEventListener('click',()=>{ $('enquirySearch').value='';scheduleSearch('enquirySearch','enquiryResults'); });
  $('clearClientBtn').addEventListener('click',resetClientForm);
  $('clearIbBtn').addEventListener('click',resetIbForm);
  $('addAccountBtn').addEventListener('click',()=>addAccountLine());$('clientForm').addEventListener('submit',saveClient);$('cancelClientEdit').addEventListener('click',resetClientForm);
  $('clientIbLookup').addEventListener('input',()=>{clearTimeout(debounceTimers.ib);debounceTimers.ib=setTimeout(suggestIB,210);});
  $('ibForm').addEventListener('submit',saveIb);$('cancelIbEdit').addEventListener('click',resetIbForm);
  ['ibSpread26Url','ibSpread36Url'].forEach(id=>$(id).addEventListener('input',updateIbLinkCopyButtons));
  $('copyIbSpread26Btn').addEventListener('click',()=>void copyIbLink($('ibSpread26Url').value.trim()));
  $('copyIbSpread36Btn').addEventListener('click',()=>void copyIbLink($('ibSpread36Url').value.trim()));
  $('mt5DeleteForm').addEventListener('submit',submitDeleteMt5);
  $('mt5DeleteCancel').addEventListener('click',closeDeleteMt5);
  $('mt5DeleteDialog').addEventListener('close',()=>{pendingDeleteAccountId=null;$('mt5DeletePin').value='';});
  resetClientForm();
}
start();
