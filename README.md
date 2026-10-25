# SkyGate Operations v4 — Deposit requests + WhatsApp copy

A mobile-first GitHub Pages website for SkyGate / NEEX operations.

## What changed in v4

- **Form auto-clear**: moving between tabs clears unfinished entry fields, searches, and the on-screen receipt preview.
- **Clear fields buttons**: explicit Clear buttons on receipt, client, IB, and enquiry screens.
- **Saved exchange rate preserved**: the IQD-per-USD rate from Supabase survives tab changes and page refreshes; an unsaved rate edit is discarded when navigating away.
- **Exact WhatsApp message**: receipt-generated, four lines, copied using the Copy message button:

  ```
  Deposit Iraq SkyGate LD
  Azad
  1300725
  1000$
  ```

  Those lines come from fixed text, receipt client name, receipt MT5 account, and **converted USD amount**, even if the user entered IQD originally.
- **Screenshot view** contains both the SkyGate receipt and the WhatsApp text in one frame. No visible copy control on the screenshot.
- **No receipt history/storage**: generating, copying and printing a receipt do not save the receipt or WhatsApp message to Supabase. The old Save record button and History tab were removed.
- Client, IB, MT5 account and notes management remain connected to Supabase when configured. Stored exchange rates remain available.

## GitHub deployment

1. Download and extract the ZIP.
2. Upload its contents, not the ZIP, to the root of GitHub repository `azadmms/Skygate`, overwriting older website files.
3. If you previously configured **config.js**, **keep your existing configured version**. The ZIP contains only a blank template.
4. Under **Settings → Pages**, set Source to Deploy from a branch, Branch `main`, Directory `/ (root)`.
5. Open https://azadmms.github.io/Skygate/ after publishing.
6. iPhone: Safari → Share → Add to Home Screen.

## Supabase

- **Already on SkyGate v3**: run `database/upgrade_v3_to_v4.sql` once in the Supabase SQL Editor. This revokes web API access to the old receipts table without deleting history.
- **Brand-new Supabase project**: run `database/schema_v4_fresh.sql` only. It creates clients, IBs, MT5 accounts, staff roles, and exchange rates, but no receipts table.
- **Still on SkyGate v2**: first back up and run `database/upgrade_v2_to_v3.sql`, then `database/upgrade_v3_to_v4.sql`.
- Never publish secret/service-role keys. Use only the public Supabase project URL and publishable key, with staff authentication and RLS enabled.

The template shows a **deposit request**, not confirmation that NEEX has credited a trading account.
