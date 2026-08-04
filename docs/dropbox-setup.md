# Dropbox import — one-time app setup

The importer browses/downloads Dropbox shared links via a Dropbox app on the
Fraggell Dropbox account. The account does not need to own the linked files.

1. https://www.dropbox.com/developers/apps → Create app → "Scoped access" →
   "Full Dropbox" (needed for shared-link reads) → name it `FootageStore Import`.
2. Permissions tab → enable `sharing.read`, `files.metadata.read`,
   `files.content.read` → Submit.
3. Settings tab → note the App key and App secret.
4. In a browser (logged into the Fraggell Dropbox), visit:
   https://www.dropbox.com/oauth2/authorize?client_id=APP_KEY&response_type=code&token_access_type=offline
   Approve, copy the code shown.
5. Exchange the code for a refresh token:
   curl https://api.dropbox.com/oauth2/token \
     -d code=THE_CODE -d grant_type=authorization_code \
     -u APP_KEY:APP_SECRET
   The response's `refresh_token` is long-lived (no expiry).
6. Add to `/mnt/user/appdata/footagestore/app/.env` on the Unraid:
   DROPBOX_APP_KEY=…
   DROPBOX_APP_SECRET=…
   DROPBOX_REFRESH_TOKEN=…
7. `docker compose up -d app worker` to pick up the env.
