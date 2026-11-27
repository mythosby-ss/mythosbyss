const router = require('express').Router();
const fs = require('fs');
const path = require('path');

// ── Plugin definitions ──────────────────────────────────────────────────────
const PLUGINS = [
  {
    id: 'logistics',
    name: 'Logistics',
    category: 'Logistics & Shipping',
    color: '#f59e0b',
    icon: 'M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0',
    desc: 'Save the API details of the courier or shipping aggregator you sign with (any company). Until it is connected, ship orders manually: enter the courier and AWB when marking an order shipped.',
    docsHint: 'Any courier / aggregator',
    features: ['Any courier / aggregator', 'Manual mode until connected', 'Courier status webhook', 'COD remittance tracking'],
    modalDesc: 'Works with whichever logistics company you sign the contract with. Your partner gives you API login details; save them here. Automatic AWB booking and tracking need a small adapter for that partner (lib/shipping/) - until then orders are shipped manually.',
    howTo: [
      'Sign the contract with your courier or aggregator',
      'Ask them for <b>API access</b> (usually under <b>Settings → API</b> in their panel)',
      'Copy the API user / email and the API password or key',
      'Paste them below with the partner\'s name and your pickup pincode'
    ],
    fields: [
      { key: 'LOGISTICS_PARTNER', envKey: 'LOGISTICS_PARTNER', label: 'Logistics partner name', placeholder: 'Company you signed with', required: true, secret: false, hint: 'Shown to your team, e.g. on shipped orders' },
      { key: 'LOGISTICS_API_USER', envKey: 'LOGISTICS_API_USER', label: 'API user / email', placeholder: 'API login given by your partner', required: false, secret: false, hint: 'Leave blank if your partner only gives an API key' },
      { key: 'LOGISTICS_API_KEY', envKey: 'LOGISTICS_API_KEY', label: 'API password / key', required: true, secret: true, hint: 'Saved only in .env, never shown again' },
      { key: 'LOGISTICS_PICKUP_PINCODE', envKey: 'LOGISTICS_PICKUP_PINCODE', label: 'Default pickup pincode', placeholder: '6-digit warehouse pincode', required: false, secret: false, hint: 'Pincode of your warehouse / dispatch address' }
    ]
  },

  {
    id: 'whatsapp',
    name: 'WhatsApp Business',
    category: 'Communication',
    color: '#22c55e',
    icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
    desc: 'Send automated order updates — confirmation, dispatch, out-for-delivery, and delivery messages — via WhatsApp Cloud API.',
    docsHint: 'developers.facebook.com',
    docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started',
    features: ['Order confirmation messages', 'Shipping & delivery alerts', 'OTP for login', 'Review request after delivery'],
    modalDesc: 'WhatsApp Cloud API (Meta) lets you send template messages to customers. Set up once and all order status updates are sent automatically.',
    howTo: [
      'Go to <b>developers.facebook.com</b> and create a Meta App',
      'Add the <b>WhatsApp</b> product to your app',
      'Under <b>WhatsApp → API Setup</b>, get your Phone Number ID',
      'Generate a <b>Permanent System User Token</b> from Meta Business Manager',
      'Create message templates in <b>WhatsApp Manager</b> (see <code>docs/WHATSAPP_TEMPLATES.md</code>)'
    ],
    fields: [
      { key: 'WHATSAPP_TOKEN', envKey: 'WHATSAPP_TOKEN', label: 'WhatsApp API Token (System User Token)', required: true, secret: true, hint: 'Permanent access token from Meta Business Manager' },
      { key: 'WHATSAPP_PHONE_ID', envKey: 'WHATSAPP_PHONE_ID', label: 'Phone Number ID', placeholder: 'Enter your Phone Number ID', required: true, secret: false, hint: 'From WhatsApp → API Setup in your Meta Developer App' },
      { key: 'WHATSAPP_BUSINESS_ID', envKey: 'WHATSAPP_BUSINESS_ID', label: 'WhatsApp Business Account ID', placeholder: 'Enter your Business Account ID', required: false, secret: false, hint: 'Optional — needed for template management via API' },
      { key: 'WA_TEMPLATE_LANG', envKey: 'WA_TEMPLATE_LANG', label: 'Template Language Code', placeholder: 'Language code (defaults to en)', required: false, secret: false, hint: 'Default: en. Use en_US, hi, etc. as approved in WhatsApp Manager' }
    ]
  },

  {
    id: 'googledrive',
    name: 'Google Drive',
    category: 'Storage & Media',
    color: '#3b82f6',
    icon: 'M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z',
    desc: 'Use the product photo folders you keep in Google Drive as your store images. Free: uses your own Drive storage, no billing needed.',
    docsHint: 'console.cloud.google.com',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    features: ['One Drive folder per product', 'Pick which folder belongs to which product', 'Add photos in Drive, re-sync in one click', 'No billing or card required'],
    modalDesc: 'The store reads your product folders using a free Google API key. Images stay in your Drive (your own storage) and are served to customers through the store.',
    howTo: [
      'In Google Drive, right-click your <b>Products Data</b> folder → <b>Share</b> → General access: <b>Anyone with the link</b> (Viewer). Copy the link',
      'Go to <b>console.cloud.google.com</b>, sign in with the same Google account and create a project (free, no billing needed)',
      'Open <b>APIs &amp; Services → Library</b>, search <b>Google Drive API</b> and click <b>Enable</b>',
      'Open <b>APIs &amp; Services → Credentials → Create credentials → API key</b>. Restrict it to the <b>Google Drive API</b>, then copy it',
      'Paste the key and the folder link below, save, then go to <b>Products → Drive images</b>'
    ],
    fields: [
      { key: 'DRIVE_API_KEY', envKey: 'DRIVE_API_KEY', label: 'Google API Key', required: true, secret: true, placeholder: 'Paste your API key (starts with AIza)', hint: 'Free key from Google Cloud Console → Credentials, restricted to the Google Drive API' },
      { key: 'DRIVE_ROOT_FOLDER_ID', envKey: 'DRIVE_ROOT_FOLDER_ID', label: 'Products Folder Link', required: true, driveId: true, secret: false, placeholder: 'Paste the Drive folder link or its ID', hint: 'The folder that contains one sub-folder per product (shared as "Anyone with the link")' },
      { key: 'UGC_DRIVE_FOLDER_ID', envKey: 'UGC_DRIVE_FOLDER_ID', label: 'UGC Videos Folder Link (optional)', required: false, driveId: true, secret: false, placeholder: 'Paste the Drive folder link or its ID', hint: 'Folder with customer testimonial videos' }
    ]
  },

  {
    id: 'metaads',
    name: 'Meta Ads',
    category: 'Performance Marketing',
    badge: 'Recommended',
    color: '#4267B2',
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    desc: 'Shows today\'s Meta ad spend, orders and cost per order on the admin home page, and adds daily spend to your profit reports automatically.',
    docsHint: 'developers.facebook.com',
    docsUrl: 'https://developers.facebook.com/docs/marketing-apis/',
    features: ['Today\'s spend on the home page', 'Cost per order (CPO)', 'Daily spend synced into P&L reports', 'Pixel & tracking: Settings → Marketing'],
    modalDesc: 'Link your Meta Ads account to pull campaign metrics and correlate them with actual orders via UTM parameters. Spend data is used in your profitability reports.',
    howTo: [
      'Go to <b>business.facebook.com</b> → Settings → Business Assets → System Users',
      'Create a System User and generate a <b>token</b> with <code>ads_read</code> permission',
      'Find your <b>Ad Account ID</b> in Ads Manager (starts with <code>act_</code>)',
      'Get your <b>App ID</b> from developers.facebook.com if using the Marketing API'
    ],
    fields: [
      { key: 'META_ACCESS_TOKEN', envKey: 'META_ACCESS_TOKEN', label: 'Meta System User Access Token', required: true, secret: true, hint: 'A System User token with the ads_read permission (Business Settings → System users → Generate token). A Pixel / Conversions API token will NOT work.' },
      { key: 'META_AD_ACCOUNT_ID', envKey: 'META_AD_ACCOUNT_ID', label: 'Ad Account ID', placeholder: 'Enter your Ad Account ID (starts with act_)', required: true, secret: false, hint: 'From Ads Manager URL or account settings — starts with act_' },
      { key: 'META_APP_ID', envKey: 'META_APP_ID', label: 'App ID (optional)', required: false, placeholder: 'Enter your Meta App ID', secret: false, hint: 'Only needed if using Graph API for campaign management' }
    ]
  },

  {
    id: 'googleads',
    name: 'Google Ads',
    category: 'Performance Marketing',
    color: '#ea4335',
    icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
    desc: 'Shows today\'s Google Ads spend, orders and cost per order on the admin home page, and adds daily spend to your profit reports automatically.',
    docsHint: 'ads.google.com',
    docsUrl: 'https://developers.google.com/google-ads/api/docs/start',
    features: ['Campaign spend tracking', 'ROAS & CPA reporting', 'UTM-based attribution', 'Monthly P&L integration'],
    modalDesc: 'Pull Google Ads campaign metrics into your admin panel. Spend data feeds into your monthly profitability reports alongside Meta Ads.',
    howTo: [
      'Go to <b>ads.google.com</b> → Tools → Google Ads API → API Center',
      'Apply for a <b>developer token</b> (Basic access for your MCC)',
      'Create an <b>OAuth2 client</b> in Google Cloud Console → APIs & Services',
      'Get your <b>Customer ID</b> from the Google Ads dashboard (top right, without dashes)',
      'Authorise the client and get your refresh token using the OAuth flow'
    ],
    fields: [
      { key: 'GOOGLE_ADS_DEVELOPER_TOKEN', envKey: 'GOOGLE_ADS_DEVELOPER_TOKEN', label: 'Google Ads Developer Token', required: true, secret: true, hint: 'From your Google Ads API Center (MCC account)' },
      { key: 'GOOGLE_ADS_CLIENT_ID', envKey: 'GOOGLE_ADS_CLIENT_ID', label: 'OAuth2 Client ID', required: true, placeholder: 'Ends with .apps.googleusercontent.com', secret: false, hint: 'From Google Cloud Console → APIs & Services → Credentials' },
      { key: 'GOOGLE_ADS_CLIENT_SECRET', envKey: 'GOOGLE_ADS_CLIENT_SECRET', label: 'OAuth2 Client Secret', required: true, secret: true, hint: 'From Google Cloud Console OAuth2 credentials' },
      { key: 'GOOGLE_ADS_REFRESH_TOKEN', envKey: 'GOOGLE_ADS_REFRESH_TOKEN', label: 'OAuth2 Refresh Token', required: true, secret: true, hint: 'Generated via Google OAuth flow with your credentials' },
      { key: 'GOOGLE_ADS_CUSTOMER_ID', envKey: 'GOOGLE_ADS_CUSTOMER_ID', label: 'Google Ads Customer ID', placeholder: '10-digit Customer ID, no dashes', required: true, secret: false, hint: 'Your Google Ads account ID without dashes (shown top-right in Ads UI)' },
      { key: 'GOOGLE_ADS_LOGIN_CUSTOMER_ID', envKey: 'GOOGLE_ADS_LOGIN_CUSTOMER_ID', label: 'Manager (MCC) account ID (optional)', placeholder: 'Only if you sign in through a manager account', required: false, secret: false, hint: 'The manager account ID, no dashes. Leave blank if you use the ad account directly' }
    ]
  }
];

// ── Helpers ──────────────────────────────────────────────────────────────────
// Treat leftover .env.example template values (xxxx, change-me, ...) as unset.
function realValue(v) {
  v = String(v || '').trim();
  return /xxxx|change-me|your-|optional-/i.test(v) ? '' : v;
}

function isConnected(plugin) {
  // A plugin is "connected" when every required field has a real value
  const requiredFields = plugin.fields.filter((f) => f.required);
  if (!requiredFields.length) return false;
  return requiredFields.every((f) => realValue(process.env[f.envKey]).length > 0);
}

// ── List page ────────────────────────────────────────────────────────────────
router.get('/plugins', (req, res) => {
  // Never send secret values to the browser: secrets only report whether they are set.
  const plugins = PLUGINS.map((p) => ({
    ...p,
    connected: isConnected(p),
    fields: p.fields.map((f) => {
      const v = realValue(process.env[f.envKey]);
      const isSet = v.length > 0;
      return { ...f, isSet, value: f.secret ? '' : v, required: f.required && !(f.secret && isSet) };
    })
  }));
  const connectedCount = plugins.filter((p) => p.connected).length;
  res.render('admin/plugins', { title: 'Plugins', plugins, connectedCount });
});

// ── Save credentials ─────────────────────────────────────────────────────────
router.post('/plugins/:id/save', (req, res) => {
  const plugin = PLUGINS.find((p) => p.id === req.params.id);
  if (!plugin) return res.redirect('/admin/plugins');

  const envPath = require('path').resolve(process.cwd(), '.env');
  let content = '';
  try { content = require('fs').readFileSync(envPath, 'utf8'); } catch (_) {}

  const updates = {};
  for (const field of plugin.fields) {
    let val = String(req.body[field.key] || '').trim();
    if (val && field.driveId) {
      const id = require('../../lib/drive').extractId(val);
      if (!id) { res.flash(`${field.label}: that doesn't look like a Google Drive folder link.`, 'err'); return res.redirect('/admin/plugins'); }
      val = id;
    }
    if (val) updates[field.envKey] = val;
  }
  // Meta: the Ad Account ID is often confused with the Pixel / dataset ID (both are long numbers)
  if (updates.META_AD_ACCOUNT_ID) {
    const acct = updates.META_AD_ACCOUNT_ID.replace(/^act_/, '');
    const pixel = String(process.env.META_PIXEL_ID || require('../../lib/settings').get('mk_pixel_id') || '');
    if (!/^\d{6,20}$/.test(acct)) { res.flash('Ad Account ID must be digits (with or without act_).', 'err'); return res.redirect('/admin/plugins'); }
    if (pixel && acct === pixel) { res.flash('That is your Pixel ID, not the Ad Account ID. Copy the number after "act=" in the Ads Manager address bar (or Business Settings → Accounts → Ad accounts).', 'err'); return res.redirect('/admin/plugins'); }
  }

  // Update or append each env var
  for (const [key, val] of Object.entries(updates)) {
    // Escape for .env: wrap in quotes if contains spaces or special chars
    const safe = val.includes('\n') || val.includes('"')
      ? `'${val.replace(/'/g, "\\'")}'`
      : val.includes(' ') ? `"${val}"` : val;

    const regex = new RegExp(`^(${key}=.*)$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${safe}`);
    } else {
      content = content.trimEnd() + `\n${key}=${safe}\n`;
    }

    // Also set in-process so it takes effect immediately
    process.env[key] = val;
  }

  try {
    require('fs').writeFileSync(envPath, content, 'utf8');
    res.flash(`${plugin.name} credentials saved. Restart the server for all changes to take full effect.`);
  } catch (err) {
    res.flash(`Saved to memory but could not write .env file: ${err.message}. Add the keys manually.`, 'err');
  }

  res.redirect('/admin/plugins');
});

// ── Disconnect ───────────────────────────────────────────────────────────────
router.post('/plugins/:id/disconnect', (req, res) => {
  const plugin = PLUGINS.find((p) => p.id === req.params.id);
  if (!plugin) return res.redirect('/admin/plugins');

  const envPath = require('path').resolve(process.cwd(), '.env');
  let content = '';
  try { content = require('fs').readFileSync(envPath, 'utf8'); } catch (_) {}

  for (const field of plugin.fields) {
    const regex = new RegExp(`^(${field.envKey}=.*)$`, 'm');
    content = content.replace(regex, `# ${field.envKey}=`);
    delete process.env[field.envKey];
  }

  try {
    require('fs').writeFileSync(envPath, content, 'utf8');
    res.flash(`${plugin.name} disconnected. Keys have been cleared from .env.`);
  } catch (err) {
    res.flash(`Disconnected in memory but could not update .env file: ${err.message}`, 'err');
  }

  res.redirect('/admin/plugins');
});

module.exports = router;
