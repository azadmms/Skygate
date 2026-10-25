# SkyGate Operations v3 — Notes instead of portal passwords

GitHub Pages frontend for NEEX/SkyGate deposit records and Supabase-backed client and IB management.

## What changed in v3

- Removed client and IB **portal password fields**, credential reveal buttons, password vault, and password-specific MFA screens. **Staff sign-in remains required** for real Supabase data.
- Added optional **Client notes** and **IB notes** fields. Notes appear in the client/IB directories and live enquiry search results and can be edited later.
- All client and IB profile fields are **optional**, including names, emails, phones, IB codes and MT5 accounts. Records can be saved blank and receive a generated database ID.
- If supplied, client emails, normalized phone numbers and MT5 account numbers must be unique. IB codes, emails, and trading account numbers must also be unique. Empty fields are allowed across many records.
- Receipt workflow is unchanged: search by name/email/MT5, enter an unregistered MT5 number manually, convert USD ⇄ IQD at the stored rate, and use screenshot view.

## Files

- `index.html`, `styles.css`, `app.js`: website files
- `config.js`: set your public Supabase Project URL and publishable key
- `assets/`: the SkyGate and NEEX images you supplied
- `database/schema_v3_fresh.sql`: **new, empty Supabase database only**
- `database/upgrade_v2_to_v3.sql`: **existing SkyGate v2 database only**
- `SETUP_GUIDE.md`: migration, security, and deployment instructions

## Security and data loss warning

**Back up your existing Supabase database before running the upgrade script.** `upgrade_v2_to_v3.sql` removes the old portal password ciphertext columns and their retrieval mechanism. This is destructive and cannot be undone without a backup. Do not enter passwords or authentication credentials in free-text notes.

The website can run in demo mode without Supabase, but demo records disappear after a refresh. Live records require an approved staff login and PostgreSQL Row Level Security.

Read `SETUP_GUIDE.md` before updating.

**Already have a working `config.js` on GitHub?** Keep that configured file when uploading v3. The ZIP includes a blank template for new projects, and overwriting your live connection settings would put the site back in demo mode.
