/* SkyGate Desk — receipt and authenticated client directory.
 * Demo data is fictional and kept in RAM only.
 * Do not place credentials or service_role keys in source files.
 */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const config = window.SKYGATE_CONFIG || {};
  const isConfigured = Boolean(config.supabaseUrl && config.supabasePublishableKey);
  const demo = !isConfigured;
  const currency = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const usdFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rateFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  let db = null;
  let clients = [];
  let history = [];
  let activeReceipt = null;
  let currentPage = 'Receipt';
  let authorized = false;

  const safe = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  const id = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `demo-${Date.now()}-${Math.floor(Math.random()*1e7)}`);
  const number = value => Number(value);
  const iqdText = v => `${currency.format(Number(v))} IQD`;
  const usdText = v => `$${usdFormat.format(Number(v))}`;
  const dateText = value => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baghdad', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(value));
  const cleanAccount = value => String(value || '').trim();
  const message = (target, value, isError=false) => { $(target).textContent = value; $(target).classList.toggle('error',isError); };
  const blank = content => `<div class="muted-blank">${content}</div>`;

  function seedDemo() {
    clients = [
      { id:'demo-c1', full_name:'Example Client One', email:'client.one@example.test', phone:'+964 750 000 0001', mt5_accounts:[{ id:'demo-a1', account_number:'1303507', label:'Primary' },{ id:'demo-a2', account_number:'1314424', label:'Second account' }]},
      { id:'demo-c2', full_name:'Example Client Two', email:'client.two@example.test', phone:'+964 750 000 0002', mt5_accounts:[{ id:'demo-a3', account_number:'1388001', label:'Standard' }]}
    ];
  }

  function showWorkArea() {
    $('loginScreen').classList.add('hidden');
    $('workArea').classList.remove('hidden');
    $('bottomNav').classList.remove('hidden');
    $('signOutButton').classList.toggle('hidden',demo);
    $('demoBanner').classList.toggle('hidden',!demo);
    $('modeTag').textContent = demo ? 'DEMO' : 'SECURE LIVE';
    $('settingsMode').textContent = demo ? 'Preview / fictional records' : 'Authenticated live database';
    $('dbStatus').textContent = demo ? 'Not connected' : 'Supabase connected';
    refreshAllViews();
    showPage(currentPage);
  }

  function showLogin(error='') {
    $('loginScreen').classList.remove('hidden');
    $('workArea').classList.add('hidden');
    $('bottomNav').classList.add('hidden');
    $('signOutButton').classList.add('hidden');
    $('modeTag').textContent = 'LOCKED';
    if(error) message('loginError',error,true);
  }

  async function confirmStaff() {
    const { data: { user }, error } = await db.auth.getUser();
    if(error || !user) return false;
    const result = await db.from('staff_users').select('role').eq('user_id',user.id).maybeSingle();
    if(result.error) throw result.error;
    return Boolean(result.data && ['admin','operator'].includes(result.data.role));
  }

  async function loadData() {
    if(demo) return;
    const [clientRes,receiptRes] = await Promise.all([
      db.from('clients').select('id,full_name,email,phone,created_at,mt5_accounts(id,account_number,label)').order('full_name',{ascending:true}).limit(1000),
      db.from('deposit_receipts').select('*').order('created_at',{ascending:false}).limit(100)
    ]);
    if(clientRes.error) throw clientRes.error;
    if(receiptRes.error) throw receiptRes.error;
    clients = (clientRes.data || []).map(c => ({ ...c, mt5_accounts: (c.mt5_accounts || []).sort((a,b) => a.account_number.localeCompare(b.account_number)) }));
    history = receiptRes.data || [];
  }

  async function checkSession() {
    try {
      const {data:{session},error} = await db.auth.getSession();
      if(error) throw error;
      if(!session){ authorized=false; showLogin(); return; }
      authorized = await confirmStaff();
      if(!authorized){ showLogin('Signed in, but this account has not been approved as SkyGate staff. Add its User UID to public.staff_users in Supabase.'); return; }
      await loadData();
      showWorkArea();
    } catch(e){ showLogin(`Unable to load secure database: ${e.message}`); }
  }

  async function signIn(event) {
    event.preventDefault();
    const button = $('loginButton');
    button.disabled=true;
    message('loginError','');
    try {
      const { error } = await db.auth.signInWithPassword({email:$('loginEmail').value.trim(), password:$('loginPassword').value});
      if(error) throw error;
      $('loginPassword').value='';
      await checkSession();
    }catch(e){ message('loginError',e.message,true); }
    finally{button.disabled=false;}
  }

  async function signOut() {
    if(!demo && db) await db.auth.signOut();
    authorized=false;
    clients=[]; history=[]; activeReceipt=null;
    $('receiptResult').classList.add('hidden');
    $('receiptEmpty').classList.remove('hidden');
    showLogin();
  }

  const titles = {
    Receipt:['New deposit record','Record an intake and generate a clean client acknowledgment.'],
    Clients:['Client management','A single customer profile can hold multiple NEEX MT5 accounts.'],
    Enquiry:['Client enquiry','Look up contact details and all linked MT5 accounts.'],
    History:['Deposit history','Review the latest deposit acknowledgments saved to your database.'],
    Settings:['Settings & security','Manage the way SkyGate Desk works and exports data.']
  };

  function showPage(page) {
    currentPage=page;
    for(const p of Object.keys(titles)) $('page'+p).classList.toggle('hidden',p!==page);
    $('pageTitle').textContent=titles[page][0];
    $('pageSubtitle').textContent=titles[page][1];
    document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('nav-active',b.dataset.page===page));
    window.scrollTo({top:0,behavior:'instant'});
  }

  function refreshAllViews() {
    renderClientOptions(); renderClients(); renderEnquiry(); renderHistory();
    $('todayTag').textContent=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Baghdad',day:'2-digit',month:'short',year:'numeric'}).format(new Date());
  }

  function getClient(cid){return clients.find(c=>c.id===cid);}

  function renderClientOptions() {
    const previous = $('receiptClient').value;
    const filtered=matchingClients($('receiptFind').value);
    const chosen=getClient(previous);
    if(chosen && !filtered.some(c=>c.id===chosen.id)) filtered.unshift(chosen);
    $('receiptClient').innerHTML='<option value="">Manual / unregistered client</option>'+filtered.map(c=>`<option value="${safe(c.id)}">${safe(c.full_name)} (${c.mt5_accounts.length} MT5)</option>`).join('');
    if(getClient(previous)) $('receiptClient').value=previous;
    toggleReceiptClient(false);
  }

  function toggleReceiptClient(reset=true) {
    const client=getClient($('receiptClient').value);
    const picker=$('accountPick');
    const showPicker=Boolean(client && client.mt5_accounts.length>1);
    picker.classList.toggle('hidden',!showPicker);
    $('accountPickLabel').classList.toggle('hidden',!showPicker);
    if(client){
      $('receiptName').value=client.full_name;
      $('receiptName').readOnly=true;
      picker.innerHTML=client.mt5_accounts.map(a=>`<option value="${safe(a.account_number)}">${safe(a.account_number)}${a.label ? ' • '+safe(a.label):''}</option>`).join('');
      if(reset) $('receiptMT5').value=client.mt5_accounts[0]?.account_number || '';
    } else {
      $('receiptName').readOnly=false;
      if(reset){$('receiptName').value='';$('receiptMT5').value='';}
    }
  }

  function calculate() {
    const amount=number($('iqdAmount').value);
    const rate=number($('exchangeRate').value);
    $('conversionValue').textContent=(Number.isFinite(amount)&&Number.isFinite(rate)&&amount>0&&rate>0)?usdText(amount/rate):'$0.00';
  }

  function refCode() {
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replace(/-/g,'');
    return `SG-${date}-${Math.floor(100000+Math.random()*900000)}`;
  }

  function makeReceipt(event) {
    event.preventDefault();
    const amount=number($('iqdAmount').value), rate=number($('exchangeRate').value);
    const mt5=cleanAccount($('receiptMT5').value);
    if(!/^\d{4,24}$/.test(mt5)){alert('Enter a valid MT5 account number (4–24 digits).');return;}
    if(!Number.isSafeInteger(amount)||amount<=0){alert('Enter a positive IQD amount without decimals.');return;}
    if(!Number.isFinite(rate)||rate<=0){alert('Enter a valid exchange rate in IQD per 1 USD.');return;}
    const client=getClient($('receiptClient').value);
    const foundAccount=client?.mt5_accounts.find(a=>a.account_number===mt5);
    activeReceipt={
      id:id(), reference_code:refCode(), client_id:client?.id||null,
      mt5_account_id:foundAccount?.id||null, client_name_snapshot:(client?.full_name||$('receiptName').value.trim()||'Not specified'),
      account_number:mt5, amount_iqd:amount, exchange_rate:rate,
      amount_usd:Math.round((amount/rate)*100)/100,
      created_at:new Date().toISOString(), saved:false
    };
    renderReceipt(activeReceipt);
    $('receiptEmpty').classList.add('hidden');
    $('receiptResult').classList.remove('hidden');
    message('receiptStatus','Ready to screenshot. Save the record to the database if you wish to keep it in history.');
    if(window.innerWidth<881) $('receiptResult').scrollIntoView({behavior:'smooth',block:'start'});
  }

  function renderReceipt(r) {
    activeReceipt=r;
    $('rcDate').textContent=dateText(r.created_at);
    $('rcIQD').textContent=iqdText(r.amount_iqd);
    $('rcUSD').textContent=usdText(r.amount_usd);
    $('rcName').textContent=r.client_name_snapshot || '—';
    $('rcMT5').textContent=r.account_number;
    $('rcRate').textContent=`1 USD = ${rateFormat.format(r.exchange_rate)} IQD`;
    $('rcConverted').textContent=`${usdText(r.amount_usd)} USD`;
    $('rcRef').textContent=r.reference_code;
    $('saveReceiptButton').disabled=Boolean(r.saved);
    $('saveReceiptButton').textContent=r.saved ? 'Record saved' : (demo?'Save to demo history':'Save record to database');
  }

  async function saveReceipt() {
    if(!activeReceipt || activeReceipt.saved) return;
    $('saveReceiptButton').disabled=true;
    try {
      if(!demo){
        const auth=await db.auth.getUser();
        if(auth.error || !auth.data.user) throw new Error('Staff session expired. Please sign in again.');
        const payload={
          reference_code:activeReceipt.reference_code,client_id:activeReceipt.client_id,
          mt5_account_id:activeReceipt.mt5_account_id,client_name_snapshot:activeReceipt.client_name_snapshot,
          account_number:activeReceipt.account_number,amount_iqd:activeReceipt.amount_iqd,
          exchange_rate:activeReceipt.exchange_rate,
          created_by:auth.data.user.id
        };
        const {data,error}=await db.from('deposit_receipts').insert(payload).select('*').single();
        if(error) throw error;
        activeReceipt={...data,saved:true};
        await loadData();
      } else {
        activeReceipt.saved=true;
        history.unshift({...activeReceipt});
      }
      renderReceipt(activeReceipt);
      renderHistory();
      message('receiptStatus',demo?'Saved in this demo session only (not online).':'Deposit record saved securely to Supabase.');
    }catch(e){
      $('saveReceiptButton').disabled=false;
      message('receiptStatus',`Could not save record: ${e.message}`,true);
    }
  }

  function screenshotMode() {
    document.body.classList.add('focus-receipt');
    $('receiptCard').addEventListener('click',exitScreenshot,{once:true});
    window.scrollTo({top:0,behavior:'instant'});
  }
  function exitScreenshot(){document.body.classList.remove('focus-receipt');}

  function addMT5Field(value='',existingId='') {
    const row=document.createElement('div');
    row.className='mt5-field';
    row.dataset.id=existingId;
    row.innerHTML=`<input type="text" inputmode="numeric" maxlength="24" placeholder="MT5 account number" value="${safe(value)}" aria-label="MT5 account number" /><button type="button" title="Remove this account field" aria-label="Remove MT5 field">×</button>`;
    row.querySelector('button').addEventListener('click',()=>row.remove());
    $('mt5Fields').appendChild(row);
  }

  function resetClientForm() {
    $('clientForm').reset();$('editingClientId').value='';
    $('mt5Fields').innerHTML='';addMT5Field();
    $('clientEditorTitle').textContent='Add client';
    $('saveClientBtn').textContent='Save client';
    $('cancelEdit').classList.add('hidden');
    message('clientMessage','');
  }

  function editClient(clientId) {
    const client=getClient(clientId);if(!client)return;
    showPage('Clients');
    $('editingClientId').value=client.id;
    $('clientName').value=client.full_name;
    $('clientEmail').value=client.email||'';
    $('clientPhone').value=client.phone||'';
    $('mt5Fields').innerHTML='';
    client.mt5_accounts.forEach(a=>addMT5Field(a.account_number,a.id));
    if(!client.mt5_accounts.length)addMT5Field();
    $('clientEditorTitle').textContent='Edit client';
    $('saveClientBtn').textContent='Update client';
    $('cancelEdit').classList.remove('hidden');
    $('clientForm').scrollIntoView({behavior:'smooth',block:'start'});
  }

  async function saveClient(event) {
    event.preventDefault();
    const editId=$('editingClientId').value;
    const full_name=$('clientName').value.trim();
    const email=$('clientEmail').value.trim()||null;
    const phone=$('clientPhone').value.trim()||null;
    const rawRows=[...$('mt5Fields').querySelectorAll('.mt5-field')].map(el=>({id:el.dataset.id,account_number:cleanAccount(el.querySelector('input').value)}));
    const accounts=rawRows.filter(a=>a.account_number);
    if(!full_name){message('clientMessage','Enter a client name.',true);return;}
    if(accounts.some(a=>!/^\d{4,24}$/.test(a.account_number))){message('clientMessage','MT5 accounts must contain 4–24 digits.',true);return;}
    if(new Set(accounts.map(a=>a.account_number)).size!==accounts.length){message('clientMessage','Duplicate MT5 numbers in this client.',true);return;}
    for(const a of accounts){
      const owner=clients.find(c=>c.id!==editId&&c.mt5_accounts.some(x=>x.account_number===a.account_number));
      if(owner){message('clientMessage',`MT5 ${a.account_number} already belongs to ${owner.full_name}.`,true);return;}
    }
    $('saveClientBtn').disabled=true;
    try{
      if(demo){
        if(editId){
          const c=getClient(editId);
          c.full_name=full_name;c.email=email;c.phone=phone;
          c.mt5_accounts=accounts.map(a=>({id:a.id||id(),account_number:a.account_number,label:''}));
        }else{
          clients.push({id:id(),full_name,email,phone,mt5_accounts:accounts.map(a=>({id:id(),account_number:a.account_number,label:''}))});
        }
      }else{
        let clientId=editId;
        if(editId){
          const result=await db.from('clients').update({full_name,email,phone}).eq('id',clientId);
          if(result.error)throw result.error;
        }else{
          const result=await db.from('clients').insert({full_name,email,phone}).select('id').single();
          if(result.error)throw result.error;
          clientId=result.data.id;
        }
        const existing=editId ? (getClient(editId)?.mt5_accounts || []):[];
        const desiredIds=new Set(accounts.filter(a=>a.id).map(a=>a.id));
        for(const old of existing){
          if(!desiredIds.has(old.id)){
            const res=await db.from('mt5_accounts').delete().eq('id',old.id);
            if(res.error)throw res.error;
          }
        }
        for(const a of accounts){
          const result=a.id ? await db.from('mt5_accounts').update({account_number:a.account_number}).eq('id',a.id)
            : await db.from('mt5_accounts').insert({client_id:clientId,account_number:a.account_number,label:''});
          if(result.error)throw result.error;
        }
        await loadData();
      }
      resetClientForm();
      refreshAllViews();
      message('clientMessage',demo?'Client updated in this preview session.':'Client and MT5 accounts saved to the secure database.');
    }catch(e){message('clientMessage',`Unable to save: ${e.message}. Refresh the directory before retrying.`,true);}
    finally{$('saveClientBtn').disabled=false;}
  }

  function accountPills(client) {
    const accounts=client.mt5_accounts||[];
    if(!accounts.length)return '<span class="pill">No linked MT5 accounts</span>';
    return accounts.map(a=>`<span class="pill">MT5 ${safe(a.account_number)}${a.label?' · '+safe(a.label):''}</span>`).join('');
  }

  function matchingClients(term) {
    const q=term.trim().toLowerCase();
    if(!q) return clients;
    return clients.filter(c=>[c.full_name,c.email,c.phone,...c.mt5_accounts.map(a=>a.account_number)].some(v=>String(v||'').toLowerCase().includes(q)));
  }

  function renderClients() {
    const records=matchingClients($('clientSearch').value);
    $('clientCount').textContent=`${clients.length} clients • ${clients.reduce((n,c)=>n+c.mt5_accounts.length,0)} MT5 accounts`;
    $('clientList').innerHTML=records.length?records.map(c=>`<div class="client-item"><div class="item-head"><h3>${safe(c.full_name)}</h3><button class="tiny-btn" type="button" data-edit-id="${safe(c.id)}">Edit</button></div><p>${safe(c.email||'No email')} ${c.phone?' · '+safe(c.phone):''}</p><div class="pills">${accountPills(c)}</div></div>`).join(''):blank('No matching clients found.');
    $('clientList').querySelectorAll('[data-edit-id]').forEach(b=>b.addEventListener('click',()=>editClient(b.dataset.editId)));
  }

  function renderEnquiry() {
    const records=matchingClients($('enquirySearch').value);
    $('enquiryResults').innerHTML=records.length?records.map(c=>`<div class="enquiry-item"><h3>${safe(c.full_name)}</h3><div class="data-row"><span>Email</span><strong>${safe(c.email||'Not provided')}</strong></div><div class="data-row"><span>Phone</span><strong>${safe(c.phone||'Not provided')}</strong></div><div class="data-row"><span>MT5</span><div class="pills">${accountPills(c)}</div></div></div>`).join(''):blank('No matching records.');
  }

  function renderHistory() {
    $('historyList').innerHTML=history.length?history.map((r,index)=>`<div class="history-item"><div><strong>${safe(iqdText(r.amount_iqd))}</strong><span>${safe(r.client_name_snapshot)} • MT5 ${safe(r.account_number)}</span><span>${safe(dateText(r.created_at))} · ${safe(r.reference_code)}</span></div><button class="tiny-btn" type="button" data-reopen="${index}">View</button></div>`).join(''):blank('No saved receipts yet. Create a receipt and choose “Save record”.');
    $('historyList').querySelectorAll('[data-reopen]').forEach(b=>b.addEventListener('click',()=>{
      const r=history[Number(b.dataset.reopen)];if(!r)return;
      renderReceipt({...r,saved:true});
      $('receiptResult').classList.remove('hidden');$('receiptEmpty').classList.add('hidden');
      showPage('Receipt');
      $('receiptResult').scrollIntoView({behavior:'smooth',block:'start'});
    }));
  }

  function exportClients() {
    if(!clients.length){alert('There are no client records to export.');return;}
    const rows=[['Name','Email','Phone','MT5 accounts'],...clients.map(c=>[c.full_name,c.email||'',c.phone||'',c.mt5_accounts.map(a=>a.account_number).join('; ')])];
    const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
    const file=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(file),link=document.createElement('a');
    link.href=url;link.download='skygate-client-directory.csv';document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function setUpEvents() {
    $('loginForm').addEventListener('submit',signIn);
    $('signOutButton').addEventListener('click',signOut);
    document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page)));
    $('receiptClient').addEventListener('change',()=>toggleReceiptClient(true));
    $('receiptFind').addEventListener('input',renderClientOptions);
    $('accountPick').addEventListener('change',e=>{$('receiptMT5').value=e.target.value;});
    $('iqdAmount').addEventListener('input',calculate);
    $('exchangeRate').addEventListener('input',calculate);
    $('receiptForm').addEventListener('submit',makeReceipt);
    $('saveReceiptButton').addEventListener('click',saveReceipt);
    $('screenshotButton').addEventListener('click',screenshotMode);
    $('downloadButton').addEventListener('click',()=>window.print());
    $('addMt5Field').addEventListener('click',()=>addMT5Field());
    $('clientForm').addEventListener('submit',saveClient);
    $('cancelEdit').addEventListener('click',resetClientForm);
    $('clientSearch').addEventListener('input',renderClients);
    $('enquirySearch').addEventListener('input',renderEnquiry);
    $('exportClientButton').addEventListener('click',exportClients);
    $('demoHelp').addEventListener('click',()=>showPage('Settings'));
    document.addEventListener('keydown',event=>{if(event.key==='Escape')exitScreenshot();});
  }

  async function init() {
    setUpEvents();resetClientForm();calculate();
    if(demo){seedDemo();showWorkArea();return;}
    if(!window.supabase || !window.supabase.createClient){showLogin('Could not load Supabase. Check your internet connection or content blocker.');return;}
    db=window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{
      auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:false}
    });
    db.auth.onAuthStateChange((event)=>{
      if(event==='SIGNED_OUT') setTimeout(()=>{authorized=false;showLogin();},0);
    });
    showLogin();await checkSession();
  }

  document.addEventListener('DOMContentLoaded',init);
})();
