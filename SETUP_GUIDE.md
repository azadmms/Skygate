# SkyGate Operations v3 — publishing and Supabase setup

## 1. Important: choose your database path

**Already using SkyGate Operations v2 with Supabase?**

1. In Supabase, create a backup/export of your existing clients, IBs, MT5 accounts, receipts, and any stored encrypted credentials you still need to retain elsewhere.
2. Open Supabase **SQL Editor → New query**.
3. Copy and run only `database/upgrade_v2_to_v3.sql`.
4. Read the output. Fix any errors before publishing the updated frontend.
5. The migration keeps existing client/IB/MT5/receipt records and adds `notes`; it permanently deletes existing stored portal-password ciphertext, the credential reveal function, and its audit table.
6. Do **not** run `schema_v3_fresh.sql` against an existing database. If your database is older than v2, migrate to v2 first or assess its existing schema manually.

**Using a new, empty Supabase project?**

1. Create a Supabase project.
2. Open **SQL Editor → New query**.
3. Copy and run only `database/schema_v3_fresh.sql`.
4. Confirm the tables exist: `staff_users`, `clients`, `ibs`, `mt5_accounts`, `exchange_rates`, `deposit_receipts`.
5. The stored initial exchange rate `1500` is an example, **not a real-time market quote**. Change it before producing real deposit records.

## 2. Configure authorized staff access

1. In Supabase, open **Authentication → Users** and create an account for yourself. Disable public signups in authentication settings so strangers cannot create accounts.
2. Copy that user's **UUID** (not the email address).
3. Open **SQL Editor**, paste the following and replace the UUID:

   ```sql
   insert into public.staff_users (user_id, role)
   values ('YOUR-AUTH-USER-UUID', 'admin')
   on conflict (user_id) do update set role=excluded.role;
   ```

4. Sign in with that staff account on the website. The database Row Level Security policies allow only approved staff users to see or change data.
5. Never put your Supabase `service_role` / secret key, database password, or customer credentials in GitHub. Use only your publishable (or legacy anon) key in the browser, together with RLS.

## 3. Edit the site's Supabase connection

In your downloaded `config.js`, enter:

```javascript
window.SKYGATE_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabasePublishableKey: 'YOUR-PUBLISHABLE-KEY'
};
```

Find these under your Supabase project's dashboard/API settings. **Do not paste a secret or service-role key**. Confirm that RLS is enabled on all operational tables before entering any real client records.

## 4. Publish on GitHub Pages

Your existing GitHub repository is `azadmms/Skygate`.

1. Extract the latest ZIP.
2. Open `https://github.com/azadmms/Skygate` and upload the extracted files to the `main` branch, **replacing previous versions of `index.html`, `app.js`, `styles.css`**, while **keeping your existing configured `config.js`** (or editing the included placeholder if new), and preserving `assets` and `database` folder paths. Upload individual files, not the ZIP itself.
3. Commit changes.
4. Open **Settings → Pages** and select **Deploy from a branch → main → /(root)**. If already configured, do not change it.
5. Check **Actions** until the Pages build completes. Expected URL: `https://azadmms.github.io/Skygate/`.
6. On iPhone, use Safari → Share → Add to Home Screen. The site uses a responsive layout and is suitable for taking a direct receipt screenshot.

## 5. Test all-optional fields and notes

1. Sign in as approved staff.
2. Open **IBs → Add introducing broker**. Enter just an internal note, leave all other fields blank, save. You should see an **Unnamed IB #...** record.
3. Open **Clients → Register client**. Enter a note only, leave name/email/phone/MT5/IB blank, save. You should see **Unnamed client #...** in the directory.
4. Edit that client and enter a name, email, one or more MT5 numbers, and choose an IB if desired.
5. Open **Enquiry**, type the name, note text, or account prefix. Notes should appear below matching clients and IBs.
6. Enter an already-used client email, phone, or MT5 number. The site/database should reject duplicate identifiers.
7. Open **Receipt**, search by client name/email/MT5 or use an unregistered MT5 number directly. Enter USD or IQD and check both conversions with the saved exchange rate. Screenshot or save the record.
8. Refresh: notes and saved rate should still come from Supabase, not browser memory.

## 6. What 'all fields optional' means

- New IB or client rows can be saved with no entered business fields at all. Each record receives a unique ID automatically.
- MT5 account *entries*, when provided, must be 4–24 digits. Blank entries are ignored. Multiple MT5 accounts may link to a single client.
- Names are **not globally unique**, because different clients may share a name. Blank and unspecified values may repeat. Unique provided identifiers remain protected by database indexes.
- The **receipt form** still requires an MT5 account and positive monetary amount/rate, because a useful receipt needs them. Making **database entry fields** optional does not remove receipt validation.
- Do not store portal passwords in notes. Free-text notes are visible to authorized staff using the enquiry interface.

## 7. Security and limitations

- Public GitHub Pages hosts static frontend files. It is not a secure database by itself. All real data lives in Supabase and should be protected by staff authentication and tested RLS.
- This version has removed the client and IB portal-password subsystem; staff still use a password to sign in through Supabase Auth.
- Test as an unauthorized/non-staff user to confirm that client records and notes are inaccessible. Use real-device passcode and preferably staff MFA.
- Adding a client with MT5 accounts is atomic for new clients through PostgreSQL `register_client`. On edits, client attributes and additional MT5 accounts are saved in separate operations; take care if a second operation fails.
- Notes are internal and might contain personal information. Obtain appropriate consent and avoid entering secrets.
- Receipt data is entered by staff and does not independently confirm NEEX credited an MT5 trading account.
- Client/IB lists initially load up to 1,000 records and interactive searches are limited. For a larger database, add server-side pagination.
