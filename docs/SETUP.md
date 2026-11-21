# Setup guide

## 1. Database (Turso free tier, up to 5 GB)
```bash
curl -sSfL https://get.tur.so/install.sh | bash      # install the CLI
turso auth signup
turso db create mythosbyss
turso db show mythosbyss --url        # -> TURSO_DATABASE_URL  (libsql://...)
turso db tokens create mythosbyss     # -> TURSO_AUTH_TOKEN
```
Tables are created automatically on first start and the 81 catalog products are seeded. Check Turso's pricing page for the current free-plan limits.
Without these two variables the app uses a local SQLite file (`data/mythosbyss.db`) - fine for development.

## 2. Google Drive (images and UGC videos)
1. Google Cloud console > create project > enable **Google Drive API** > IAM > Service accounts > create > Keys > add JSON key.
2. In Drive, create a folder (e.g. "MythosBySS Media"). Share it with the service account's `client_email` as **Editor**. Put its id in `DRIVE_ROOT_FOLDER_ID`.
3. Share your existing image folder and UGC video folder with the same email (Viewer is enough) and set `DRIVE_IMAGES_FOLDER_ID`, `UGC_DRIVE_FOLDER_ID`.
4. Paste the JSON key (single line) into `GOOGLE_SERVICE_ACCOUNT_JSON`.
* Uploaded files are placed in `<root>/<Category>/` and set to "anyone with the link can view". The site serves them through `/media/<fileId>` (cached) so they load reliably.
* Caveat: Google may refuse uploads by a service account into a personal "My Drive" folder (storage quota error). If that happens, put the root folder in a **Shared Drive**, or paste Drive links manually in the admin form.

## 3. WhatsApp
1. https://developers.facebook.com > create an app (Business) > add **WhatsApp** product. Add and verify your business number.
2. Create a permanent System User token with `whatsapp_business_messaging` -> `WHATSAPP_TOKEN`; copy the Phone number ID -> `WHATSAPP_PHONE_ID`.
3. Create the 6 templates in `docs/WHATSAPP_TEMPLATES.md` and wait for approval.
4. Set the webhook as described there. Test from Admin > Communication.

## 4. Razorpay
Keys from the dashboard (use `rzp_test_` first). Add the webhook `https://YOURDOMAIN.com/webhooks/razorpay` for `payment.captured` and `order.paid`.

## 5. Run
```bash
cp .env.example .env && npm install && npm run dev      # http://localhost:3000   admin: /admin
```
Production: `NODE_ENV=production`, a real `SESSION_SECRET`, HTTPS, `SITE_URL=https://yourdomain.com`, then `npm run build:css && npm start`.
