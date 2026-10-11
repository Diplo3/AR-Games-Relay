# Short license codes

Both the buyer's request code and the activation code are 25 characters (`RQ-` / `AC-` plus a 22-character body). The request handle expires after 30 days. The activation handle expires after 30 days and can only be redeemed by the matching installation and game. The relay returns the signed license token once; the game validates and stores it locally, so subsequent launches work offline.

## Configure the existing Render service without changing its plan

1. Create a Supabase project and open **SQL Editor**. Run `database/license-short-codes.sql` from this repository.
2. In Supabase project settings, copy the project URL and the `service_role` key. Keep the service key private; it must only be configured as a Render secret.
3. In Render, open the existing `AR-Games-Relay` web service and add these environment variables:
   - `SUPABASE_URL` — project URL.
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase `service_role` key.
   - `LICENSE_RELAY_ADMIN_KEY` — the exact random secret generated in the owner panel's `.env` file. Keep it identical in both places.
4. Save the environment and deploy the existing service. Leave the current Render plan unchanged.
5. In the owner panel's install folder, open `.env` and copy `LICENSE_RELAY_ADMIN_KEY` into Render. The owner panel already has `LICENSE_RELAY_URL=https://ar-games-relay.onrender.com`.

Do not commit `.env` or put any of these secrets into a game build. The relay stores only hashes of short codes and the signed token needed for redemption; it does not store customer names or contact details. Supabase Free can be used for a no-cost test, but free projects may pause and have limited recovery options. Keep the owner's SQLite database and signing key in encrypted backups. For a commercial production system with thousands of sales, configure durable database backups before relying on it as the only redemption store; a paid plan must not be enabled without the owner's explicit approval.

## Quick check

After deployment, a game should create an `RQ-...` code. Enter it in the selected customer's license in the owner panel. The panel should return an `AC-...` code. Paste it into that same game installation while online; the game should activate and launch offline afterward. A request code or activation code remains single-purpose and expires after 30 days.
