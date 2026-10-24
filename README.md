# SkyGate Desk × NEEX — Mobile Deposit Operations

A lightweight GitHub Pages frontend with an optional **real Supabase database**.

## Features

- Original SkyGate and NEEX supplied logos
- Client deposit acknowledgment: client name, MT5 number, IQD amount, rate (IQD per 1 USD), USD equivalent, reference and Iraq-local timestamp
- No watermark; clean "Screenshot view" hides the editor and website controls (tap the receipt to exit)
- Save receipt records to a database after staff confirmation, or preview in a fictional demo
- Client directory: name, email, phone, multiple MT5 accounts per client
- Search by name, contact information, or any linked MT5 number
- Receipt history and printable/PDF copy
- iPhone-responsive layout and Safari Add to Home Screen compatibility
- Passwords for clients' trading accounts **are not collected or stored**

**The receipt is an acknowledgement of a SkyGate intake record. It is NOT evidence that NEEX or the MT5 trading account has been credited.** Only generate truthful records for actual transactions. The document has a normal explanatory footer rather than a watermark.

## 1 — Quick deployment: GitHub Pages

Upload the contents of this ZIP (not the ZIP itself) into your existing GitHub repository's root, for example `azadmms/Neex`:

```text
index.html
styles.css
app.js
config.js
.nojekyll
assets/neex.png
assets/skygate.png
database/schema.sql
README.md
```

On your repository, open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch → main → / (root)**. Commit all files to the main branch. Your site URL should resemble:

`https://azadmms.github.io/Neex/`

Until Supabase is connected, the website displays **fictional sample clients in demo mode**. Demo records exist in temporary browser memory only: they are not shared between phones, and they disappear on page reload.

## 2 — Make the database online (Supabase free tier)

1. Open https://supabase.com/ and create a free project. Store the project's database admin password in a trusted password manager.
2. In the Supabase project, open **SQL Editor**, paste and run all of `database/schema.sql`. Use a dedicated new project to avoid mixing with other tables.
3. Open **Authentication → Users → Add user** and create a staff user with a strong password. If you create a user via an invitation email, complete the invitation before logging in.
4. Copy that user's **User UID** (UUID).
5. In **SQL Editor**, run this SQL with the real UUID:

```sql
insert into public.staff_users (user_id, role)
values ('PASTE-ACTUAL-AUTH-USER-UUID-HERE', 'admin');
```

6. Under **Authentication → Providers → Email**, **disable public signups**. Create any additional staff accounts manually through the Supabase dashboard and explicitly add their UUID to `staff_users` with an appropriate role.
7. Under **Project Settings → API Keys / Data API**, copy your project URL and your **publishable** key (or legacy **anon** key). **Never copy the secret/service_role key.**
8. Edit `config.js` on GitHub, preserving the quote marks:

```javascript
window.SKYGATE_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabasePublishableKey: 'YOUR-SUPABASE-PUBLISHABLE-KEY'
};
```

9. Commit changes. Open your GitHub Pages website, sign in with your approved staff email and password, and try adding **one fictional TEST client** with two MT5 numbers. Generate, save, and reopen one test receipt.
10. Open the site on another device with the **same authorized staff account** to verify records sync. Sign out and confirm that customer records are not visible. Test an unauthorized Supabase user too: the dashboard must deny access.
11. Before adding real client data, configure an MFA method for the staff account, review the database's security advisors, verify RLS policies and test user roles. Supabase features and pricing can change.

**IMPORTANT:** A Supabase publishable/anon key is expected to be visible in browser JavaScript. Database safety relies on server-side Supabase Auth, grants, and Row Level Security rules. Never put a `service_role` key or a trading password in this repository.

## 3 — Daily workflow

1. Sign in on iPhone through your GitHub Pages website.
2. Open **Clients → Add client**. Enter name/email/phone and as many MT5 account numbers as needed.
3. Open **Receipt**, select that client, and select the relevant MT5 number.
4. Enter amount in **IQD** and the rate expressed as **IQD per 1 USD** (example: `1500`). The form calculates USD as `IQD / rate`.
5. Click **Generate receipt**. Confirm the details are correct. Tap **Screenshot view**, then use the iPhone side-button + volume-up to take a screenshot. Tap the receipt to return to the editor.
6. Press **Save record to database** once it reflects an actual SkyGate transaction. Reopen from **History** later.
7. Choose **Save PDF / Print** for a printer-friendly copy.

**Note:** "Save record" means your SkyGate intake record is stored; it does not independently verify a broker deposit. The app does not connect to NEEX's MT5 servers or validate account balances.

## 4 — Security and client passwords

- The requested numeric PIN `123` is **not** implemented. A PIN hardcoded into a public GitHub Pages site could be read or bypassed by anyone. It cannot safely gate customer contact data or trading passwords.
- Client trading passwords are **not stored in the database**, never exported, and never displayed in lookup.
- If a client needs account access, use NEEX/MT5's authorized password-reset or account-management workflow. If your organization has a legitimate need to hold client credentials, use an approved enterprise password vault with individual staff permissions, MFA, audit logs, and appropriate client consent—not GitHub or a normal Supabase table.
- Use unique staff credentials, MFA, device PIN/Face ID, and sign out on shared devices.
- Exported CSV files contain personal client information. Store them securely and avoid sending by ordinary chat applications.
- Receipts are readable only to permitted Supabase users in the database, but customers may see a receipt screenshot you share with them.
- Don't add private customer data to the HTML, GitHub commits, or demo seed records.

## 5 — Database structure

`staff_users` — allowlisted staff auth user IDs and roles.

`clients` — client ID, name, email, phone.

`mt5_accounts` — account ID, unique account number, foreign key `client_id`. Multiple accounts per one client.

`deposit_receipts` — immutable intake records linked to client/account when selected. The USD amount is calculated by PostgreSQL from the IQD amount and entered rate. The database timestamp is generated on save.

Database grants and RLS are defined in `database/schema.sql`. Public/anonymous users have **no access** to these tables. Staff can read/add/edit clients and MT5 accounts; receipts are insert/read-only in the app. The database design is intended as a secure starting point, **not** a completed independent penetration test or regulatory compliance certification.

## 6 — Free-tier considerations

Free hosting with GitHub Pages and free Supabase are suitable for an initial small deployment, subject to provider quotas, inactivity pausing and usage policies. As actual client volume grows, use a paid plan with backup/recovery, monitoring, company access management and appropriate legal/privacy review. GitHub Pages remains a public static host; only the Supabase database stores protected customer records.

## 7 — Update the website

Edit the GitHub repository files and commit changes on `main`. GitHub Pages republishes the new version. No separate server or Node.js build is required.
