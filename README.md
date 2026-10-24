# SkyGate Desk v2 — NEEX Deposit Operations

Mobile-first client, introducing broker and SkyGate deposit record management. This is a static frontend designed for GitHub Pages, with a separate, secured Supabase PostgreSQL backend.

**Begin here:** [SETUP_GUIDE.md](SETUP_GUIDE.md)

## Included

- `index.html`: website and mobile UI
- `styles.css`: responsive layout including iPhone safe areas and screenshot view
- `app.js`: search, conversion, registration, Supabase, encrypted credential vault and MFA
- `config.js`: public Supabase URL and **publishable** key placeholders
- `database/schema_v2.sql`: Supabase schema with RLS, roles, constraints, MFA-gated secret retrieval and audit
- `assets/`: the SkyGate and NEEX logos supplied in chat
- `.nojekyll`: GitHub Pages compatibility file

## Application tabs

- **Receipt**: search clients/MT5 via Supabase, pick or enter unregistered MT5, enter the amount in USD **or** IQD, apply the persisted IQD-per-USD rate, produce a clean screenshot-ready record, optionally save it in Supabase. Receipt date uses Asia/Baghdad timezone, with the source transaction captured by the browser.
- **Enquiry**: debounced per-keystroke lookup against Supabase client name/email/phone, IB name/code/email/trading account, and MT5 account **prefix**. Finds clients linked to matching IBs and multiple MT5 accounts.
- **Clients**: add/edit client details; client email and normalized phone must be unique, and every MT5 number must be globally unique. The client dropdown for IB is searchable; an IB may have multiple clients. Initial creation of a client with their accounts is atomic in Postgres.
- **IBs**: manage IB code, name, email, phone, trading account and assigned clients.
- **History**: browse saved deposit records.
- **Settings**: connected status and enrollment/challenge for staff authenticator-based MFA.

## Conversion

**Rate is always IQD per 1 USD**.

- USD to IQD = USD × rate; IQD is rounded to the nearest whole dinar.
- IQD to USD = IQD ÷ rate; USD is rounded to 2 decimals.
- Each saved deposit record retains both amounts, the original entry currency and source amount, plus the exchange rate used at the time.
- Rates are saved in `public.exchange_rates`, row `id=1`, and load from Supabase on page refresh. The `1500` created initially is only an example placeholder, **not a market quote**.

## Password vault design

- Portal passwords are **never** written as plaintext to Supabase or your GitHub repository. On create/update, a separately entered, strong vault passphrase is used in browser-side PBKDF2-SHA256 / AES-256-GCM encryption. Only ciphertext, salt and IV are saved in the client or IB row.
- Staff who have completed **Supabase MFA** can request encrypted secret retrieval through `reveal_portal_secret`, which writes an audit log entry. Users then enter the correct vault passphrase to decrypt locally; visible passwords disappear automatically after 20 seconds.
- Vault passphrases are **not saved or recoverable** by this application. Losing the passphrase means losing access to passwords encrypted with it. If staff share the vault, agree on a controlled enterprise secret-management procedure. Client consent and broker policy approval may be required to hold account credentials.
- The prototype is not a substitute for a professionally administered password manager. Prefer NEEX's official account recovery / password-reset service whenever possible.
- **Do not implement a hardcoded PIN `123`, or store your Supabase service_role/secret key in GitHub.** Those would expose customer data.
- You should enable MFA on each staff user and review Supabase security before using real data.

## Scope and limitations

The receipt is a **SkyGate internal deposit acknowledgement**, not evidence that NEEX has credited an MT5 account. Generate receipts only for transactions that really occurred. There is no watermark, but the footer clearly describes the document's scope. The website does not connect to NEEX servers to verify broker balances. As with any browser-generated document, it is not independently tamper-proof.

The website is designed for an initial small staff deployment. Client/IB search is **server-backed** but caps results per query; add pagination for very large databases. The client editor adds extra accounts but does not delete or reassign previously registered numbers. Receipt records are read/insert-only for staff. Browser-side demo records are fictional and disappear after refresh.

Database security is not audited. Before production, obtain company approval, ensure clients consent to personal data processing and credential custody, enforce device controls and MFA, test database RLS with a non-staff account, and configure backups and monitoring.
