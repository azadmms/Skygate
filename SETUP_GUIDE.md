# Step-by-step: SkyGate GitHub + Supabase

This guide configures `https://azadmms.github.io/Skygate/` based on the repository name supplied in your previous messages. GitHub names and paths are case-sensitive in Pages URLs.

## A. Publish the updated website through GitHub Pages

1. Download the ZIP file from ChatGPT and **extract** it in Files on iPhone or in Windows Explorer.
2. Go to **https://github.com/azadmms/Skygate** in Safari or on your computer and sign in.
3. Select **Code → Add file → Upload files**. Upload all extracted files **including the assets folder**. Replace the existing website files if asked. Keep `index.html`, `app.js`, `styles.css` and `config.js` in the repository root.
4. Select **Commit changes** on the `main` branch. A repository filename list should resemble:
   ```
   index.html
   app.js
   styles.css
   config.js
   README.md
   SETUP_GUIDE.md
   assets/neex.png
   assets/skygate.png
   database/schema_v2.sql
   .nojekyll
   ```
5. Go to **Repository → Settings → Pages**, select **Deploy from a branch**, then `main` and `/ (root)`, then Save. Your earlier Pages settings may already have these values.
6. Open **Repository → Actions** and confirm `pages build and deployment` finishes successfully. Visit **https://azadmms.github.io/Skygate/**.
7. Until the database is configured, the website shows **DEMO MODE** with fictional clients. **Do not enter real client information in demo mode.**
8. On iPhone, open the website in Safari → Share → **Add to Home Screen**. The layout automatically adapts to iPhone 17 Pro Max and other mobile sizes.

## B. Create your free Supabase project

1. Visit **https://supabase.com/dashboard** and sign in.
2. Click **New project**, choose an organization and a new project, select the region closest to you, and set a strong **database** password. Save it in a password manager.
3. Wait until your project is created.
4. Open **SQL Editor → New query**.
5. Open `database/schema_v2.sql` on your computer, copy its **entire** contents, paste them into the SQL Editor, and click **Run**. This creates:
   - `staff_users` — allowlisted team members
   - `ibs` — introducing brokers
   - `clients` — client records and encrypted credential payloads
   - `mt5_accounts` — many accounts per client
   - `exchange_rates` — one persisted IQD-per-USD rate
   - `deposit_receipts` — intake records with both IQD and USD
   - `portal_access_audit` — credential retrieval log
   - `register_client` and `reveal_portal_secret` protected RPC functions
6. If you ran the **previous SkyGate schema** already, take a database backup and check duplicates before running the new file. `schema_v2.sql` migrates the previous table layout in place and retains existing client/MT5/receipt records. **Run the SQL once**, not repeatedly.
7. Open **Authentication → Users → Add user** and create a staff user with a strong password and your own email. Follow verification instructions if shown.
8. Copy the newly created staff user's **UID (UUID)**. Open SQL Editor and run the following, replacing the example UUID:
   ```sql
   insert into public.staff_users (user_id, role)
   values ('REPLACE-WITH-REAL-STAFF-USER-UUID', 'admin');
   ```
   To authorize another operator, create their Auth user and insert their UUID with role `operator`.
9. In **Authentication → Providers → Email**, disable public self-signups. Keep email/password login enabled for explicitly created staff users. Require strong passwords and encourage MFA for all staff.
10. Under **Project Settings → API Keys** (sometimes **Settings → API Keys**, naming changes by dashboard version), copy the project's **Project URL** and **publishable key**, or legacy **anon key**. **Never** use a `service_role`, `secret`, JWT signing secret, or database password in the website.
11. In the public GitHub repository edit `config.js` to:
   ```javascript
   window.SKYGATE_CONFIG = {
     supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
     supabasePublishableKey: 'YOUR-PUBLISHABLE-OR-ANON-KEY'
   };
   ```
   These specific values are safe to ship in browser code **only because the SQL enables and restricts RLS and table grants**. Never put any real customer data in the repository.
12. Commit `config.js`, allow Pages to redeploy, reload the website. You will now see a **staff login** instead of demo mode. Sign in using the account from step 7.
13. If sign-in works but you see **not approved**, check the `staff_users` row matches exactly the Supabase Auth UID.

## C. Test the database using fictional records

1. Open **IBs → Add introducing broker**. Create `IB-TEST01`, name `Sample Partner`, optional email, trading account number `99001234`.
2. Open **Clients → Register client**. Type `Sample Customer`, email `sample.test@example.com`, phone `+9647001239876`. Start typing `IB-TEST01` in the searchable IB field, then select the matching suggestion.
3. Enter MT5 account `1315001`, tap **Add another MT5 account**, enter `1315002`, then save.
4. Open **Enquiry** and type `Sample`: the customer should appear. Type `1315`: both linked numbers should appear. Type `IB-TEST01`: the broker and its linked client should appear.
5. Try registering that same email, phone, or MT5 number again. You should receive **client already registered**. Both the UI and SQL database unique indexes enforce this.
6. Open **Receipt**, type `1315`, select the customer and one MT5 account. Enter `100 USD` and rate `1500` → display `150,000 IQD` and `$100.00 USD`.
7. Change input currency to **IQD**, enter `300000` at rate `1500` → display `$200.00 USD` and `300,000 IQD`.
8. Click **Save rate**, refresh the website, and verify it loads the rate you saved from Supabase.
9. Test an account not in the database, e.g. `77776666`. Type that number manually; receipt creation should still work, with no associated client record.
10. Click **Generate receipt → Screenshot view** and take an iPhone screenshot. Tap the receipt to exit screenshot mode. Optionally save the actual intake record to database.
11. Create another **test-only Supabase Auth user NOT in `staff_users`** and confirm the login is rejected. This is a critical authorization check.

## D. Safely handle portal passwords

**Do not paste real broker portal passwords into GitHub, email, support messages or Supabase SQL editor.** Ensure you are authorized by the account holder and NEEX to hold credentials.

1. In the Clients or IBs form, open **Optional portal password (encrypted)**.
2. Enter a test portal password, then a **different strong vault passphrase (12+ characters)**. You and authorized staff must securely manage this vault passphrase outside the website. It is not stored by the system.
3. Save. The browser encrypts the password with AES-GCM before the ciphertext is sent to Supabase.
4. Open **Settings → Set up MFA authenticator**. Scan the QR with an authenticator application and enter its one-time code to enroll.
5. On later logins, open **Settings** and complete **Unlock credential access** with a new authenticator code.
6. Search for the client or IB in **Enquiry**; click **Reveal portal password** and enter the vault passphrase.
7. The website calls an MFA-restricted SQL function that logs who retrieved the encrypted blob, then decrypts it in your browser. The revealed password automatically disappears after 20 seconds.
8. If you forget the vault passphrase, the password cannot be recovered by SkyGate or Supabase. Use official NEEX account password recovery to replace it. This scheme is an MVP; a professionally managed business password manager is preferable for sensitive client credentials.

## E. Troubleshooting

- **GitHub 404**: verify repository is public; `index.html` is in root; Pages = `main / (root)`; deployment succeeds in Actions; URL capitalization `Skygate` is correct.
- **Assets absent**: make sure `assets/neex.png` and `assets/skygate.png` uploaded with exact filenames.
- **Login form never appears**: verify `config.js` has both URL and publishable key; refresh Safari, clear cache if needed, inspect browser console.
- **`permission denied`, `schema cache`, `function not found`**: ensure the complete SQL file ran successfully in the same Supabase project, `public` is exposed through the Supabase Data API, and you added your staff auth UID to `staff_users`.
- **Duplicate error**: one of the unique indexes already contains the email, phone, MT5 number, IB code/email or IB trading account number.
- **Empty search**: check RLS authorization, matching IB and MT5 rows, and internet connectivity. Results update as you type but are capped for performance.
- **Rate not retained**: check that you clicked **Save rate** while signed in and the rate row was successfully written. If the website says DEMO, there is no online database connection.
- **Can't reveal credential**: sign in as an authorized staff user, complete Supabase TOTP MFA for the current session, and enter the correct vault passphrase.

## F. Production safety

GitHub Pages serves PUBLIC files; it is not a private backend. Supabase RLS + grants are what enforce record permissions. Verify both are functioning before using real clients. Credentials require business consent, stronger device controls, staff-level authorization policies, backups and security review. Screenshots of receipts can be shared intentionally, but the receipt footer does **not** claim NEEX credited an account.
