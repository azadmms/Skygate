# SkyGate Operations v4 — Deployment & migration guide

## A. Update the website

1. Open the ZIP and extract it.
2. Upload `index.html`, `styles.css`, `app.js`, `assets/`, `.nojekyll`, and any unchanged files to the ROOT of https://github.com/azadmms/Skygate.
3. **Do not overwrite an existing configured `config.js`**. Preserve its Supabase URL and publishable key. Upload the included blank `config.js` only if installing for the first time, then fill its public URL/key.
4. GitHub Settings → Pages → Deploy from a branch → `main` → `/(root)` → Save.
5. Check the site's exact path: https://azadmms.github.io/Skygate/.
6. Reload in Safari (a hard refresh if older JS was cached); reopen the Home Screen shortcut if applicable.

## B. Database changes

### Existing v3 project

Open Supabase Dashboard → select the SkyGate project → SQL Editor → New query.

- Back up your database before changes.
- Paste and run `database/upgrade_v3_to_v4.sql`.
- It **revokes anon/authenticated access to receipt records**. Existing historical receipts remain in the table; they are not shown in the website and new receipt requests are never inserted.
- If you later decide to delete historical receipts completely, do this separately after backup, with administrator approval.

### Existing v2 project

Run `database/upgrade_v2_to_v3.sql` first (its password removal is destructive; back up), then the v4 upgrade.

### New project

Run `database/schema_v4_fresh.sql`. Create an authorized staff user in Supabase Auth, then in SQL Editor:

```sql
insert into public.staff_users (user_id,role)
values ('YOUR-AUTH-USER-UUID','admin');
```

Then add your URL and public publishable key to `config.js`.

## C. Daily workflow

1. Open **Receipt**.
2. Search by MT5 account, email, or client name. Pick a match if one exists; manual account numbers still work.
3. Enter the desired USD or IQD amount. Check the saved IQD-per-USD rate. Use Save rate if changing the persistent rate.
4. Generate receipt. The exact WhatsApp message appears underneath.
5. Tap **Copy message**, open the relevant WhatsApp group, and paste it.
6. Tap **Screenshot view** and take an iPhone screenshot of the receipt plus four-line message.
7. Tap screenshot to close, or switch to another tab to clear the fields automatically.

The message is exactly:

```
Deposit Iraq SkyGate LD
<Client field>
<MT5 account field>
<USD equivalent without comma, followed by $>
```

Example:

```
Deposit Iraq SkyGate LD
Azad
1300725
1000$
```

## D. What is saved?

**Saved to Supabase** when logged in: client/IB profiles and linked MT5 accounts, notes, and exchange rates on Save rate.

**Not saved**: receipt drafts, completed deposit requests, WhatsApp message text, copied clipboard content, and screenshots.

## E. Notes

- The exchange rate is a manual staff-defined rate, not a live FX quote.
- Your website and Supabase must be accessed over HTTPS for the browser clipboard API to work smoothly on iPhone. The Copy button includes a fallback, but browser permissions can still block it.
- This document is a **request for deposit processing**, not independent evidence that the broker credited funds.
