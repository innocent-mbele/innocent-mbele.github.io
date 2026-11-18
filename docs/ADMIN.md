# Admin page: setup and use

The website has a private admin page. You open it at **innocent-mbele.github.io/inno**. It sends you to the admin service, where you sign in with Microsoft and can change:

- your introduction, tagline, footer text and profile photo (upload, crop, shape, size and which part stays in view)
- your links (GitHub, LinkedIn or any other)
- the repositories table
- projects: add, edit, reorder, delete, upload screenshots, choose the card picture, choose which projects show first
- project areas (the filter tabs) and the contact form key

When you press **Publish changes**, the admin saves everything to the website repository in one commit. GitHub Actions then rebuilds and publishes the site. The live site updates in about two minutes, and every change can be seen and undone in the repository history.

## Why Microsoft sign-in and not Gmail

I chose Microsoft Entra ID because it is the only one of the two that lets you **enforce** security rules:

| | Microsoft Entra ID | Google (Gmail) account |
|---|---|---|
| Force MFA for this app | Yes, with Security defaults (free) or a Conditional Access policy | No. 2-Step Verification is your personal setting and the app cannot check it |
| Conditional Access (location, risk, sign-in frequency, security key only) | Yes (needs Entra ID P1 or a trial) | No |
| Proof of MFA in the sign-in token | Yes, the `amr` claim says `mfa` | No |
| Sign-in logs you can review | Yes | No |
| Allow only one named person | Yes, by Object ID and app assignment | Only by email address |

It also matches the Azure work in your portfolio.

## How the admin is protected

Microsoft checks first:
1. Your password, then MFA (Microsoft Authenticator or a security key).
2. Any Conditional Access policies you create in your tenant.
3. Only users assigned to the app can sign in (step 1.6 below).

Then the admin service checks again on its own:
1. The sign-in token is genuine: Microsoft's signature, your tenant, this app, not expired, plus state, nonce and PKCE.
2. Your Object ID is on `ENTRA_ALLOWED_USERS` and/or your sign-in address is on `ENTRA_ALLOWED_EMAILS`.
3. **MFA was used**: the token's `amr` claim must contain `mfa`. Otherwise sign-in is refused.
4. **You are in an allowed country** (`ADMIN_ALLOWED_COUNTRIES`, for example `AE,ZW`). Otherwise sign-in is refused.
5. The session lasts 2 hours. It is tied to the country and the browser you signed in from, so a copied cookie does not work anywhere else.
6. Every sign-in asks for your password again. The admin never reuses an existing Microsoft session silently.
7. Changes are only accepted from the admin page itself. The service only writes to `data/` and image folders, only takes WebP images and checks every field.

The service keeps no passwords. Its secrets live only in Cloudflare.

## Personal Microsoft account option (outlook.com)

Instead of a tenant user you can sign in with a personal Microsoft account such as `you@outlook.com`. This is what the site uses now.

1. Entra → **App registrations** → **New registration**. Supported account types: **Personal Microsoft accounts only**. Redirect URI: **Web**, `https://inno-admin.<your-subdomain>.workers.dev/inno/auth/callback`.
2. **Certificates & secrets** → new client secret. Copy the **Value**, not the Secret ID.
3. **Manifest**: set `"optionalClaims"` to `{ "idToken": [ { "name": "amr", "essential": false } ], "accessToken": [], "saml2Token": [] }`.
4. In Cloudflare set `ENTRA_TENANT_ID` = `consumers`, `ENTRA_CLIENT_ID` = the new app's client ID, `ENTRA_CLIENT_SECRET` = the new value, and `ENTRA_ALLOWED_EMAILS` = your address. Delete `ENTRA_ALLOWED_USERS`, because the tenant user's Object ID no longer applies.
5. After the first sign-in, the Worker log shows `admin: signed in <id> <address> …`. Add that ID as `ENTRA_ALLOWED_USERS`. From then on both the ID and the address must match.
6. Turn on two-step verification at https://account.microsoft.com/security. If Microsoft does not report MFA for personal accounts, the refusal page lists what it did report. Only then set `REQUIRE_MFA` = `false`, and rely on the account's own two-step verification.

There is no admin consent, app assignment or Conditional Access for personal accounts. The allow-list in the Worker is what keeps everyone else out.

## What you need

- Your Azure tenant (the one you use for your Azure labs)
- A free Cloudflare account (you already have one)
- 30 to 40 minutes

## 1. Microsoft Entra ID

### 1.1 Admin user

Use a **work account in your tenant** rather than your Gmail or Outlook guest account, because MFA is reported reliably for tenant accounts.

Azure portal → **Microsoft Entra ID** → **Users** → **New user** → **Create new user**:
- User principal name: for example `webadmin@<your tenant>.onmicrosoft.com`
- Display name: `Innocent Mbele`
- Note the temporary password, then sign in once at https://myaccount.microsoft.com, change the password and register **Microsoft Authenticator**. Add your YubiKey here too when you get it.

Open the new user and copy its **Object ID**. You need it for `ENTRA_ALLOWED_USERS`.

### 1.2 Make MFA compulsory

The admin refuses any sign-in without MFA, so Microsoft must ask for MFA **every time** this user signs in. Choose **one**:
- **With Entra ID P1 (or the free 30-day trial), recommended:** create the Conditional Access policies in 1.7. Security defaults must be off.
- **Free:** turn Security defaults off (Entra ID → **Overview** → **Properties** → **Manage security defaults**). Then Entra ID → **Users** → **Per-user MFA** → tick your admin user → **Enable MFA**, then set it to **Enforced**. Do not use Security defaults for this. Security defaults only ask normal users for MFA when Microsoft thinks it is needed, so some sign-ins would arrive without MFA and the admin would refuse them.

If you see "Multifactor authentication is required" after signing in, Microsoft did not ask you for MFA. Check this step.

### 1.3 App registration

Entra ID → **App registrations** → **New registration**:

| Field | Value |
|---|---|
| Name | `innocent-mbele website admin` |
| Supported account types | **Accounts in this organizational directory only** |
| Redirect URI | Platform **Web**: `https://inno-admin.<your-subdomain>.workers.dev/inno/auth/callback` (you get the exact address in step 3. You can add it afterwards) |

Then copy from **Overview**:
- **Application (client) ID** → `ENTRA_CLIENT_ID`
- **Directory (tenant) ID** → `ENTRA_TENANT_ID`

### 1.4 Client secret

**Certificates & secrets** → **New client secret** → expiry 12 months → **Add**. Copy the **Value** (not the Secret ID) → `ENTRA_CLIENT_SECRET`. It is shown only once.

### 1.5 Add the MFA claim to the token (required)

**Token configuration** → **Add optional claim** → Token type **ID** → tick **amr** → **Add**.

Without this the admin cannot see that you used MFA, so it refuses every sign-in.

### 1.6 Only you may sign in

Entra ID → **Enterprise applications** → `innocent-mbele website admin` → **Properties** → **Assignment required?** = **Yes** → Save. Then **Users and groups** → **Add user/group** → add only your admin user.

### 1.7 Conditional Access (only with Entra ID P1 or a trial)

Entra ID → **Security** → **Conditional Access**:
1. **Named location**: create "Allowed countries" with United Arab Emirates (and Zimbabwe if you want).
2. **Policy "Website admin – MFA"**: Users = your admin user. Target resources = `innocent-mbele website admin`. Grant = **Require authentication strength: Multifactor** (or **Phishing-resistant MFA** once your YubiKey is registered). Session = **Sign-in frequency 2 hours**. Turn it **On**.
3. **Policy "Website admin – block other countries"**: same user and app. Conditions → Locations → Include **Any location**, Exclude **Allowed countries**. Grant = **Block access**. Turn it **On**.

Microsoft then enforces these before the admin's own checks.

## 2. GitHub token

GitHub → **Settings** → **Developer settings** → **Fine-grained personal access tokens** → **Generate new token**:
- Repository access: **Only select repositories** → `innocent-mbele.github.io`
- Permissions: **Contents: Read and write** (nothing else)
- Expiration: 1 year

Copy the `github_pat_…` value → `GITHUB_TOKEN`. This token only lets the admin save into the website repository.

## 3. Cloudflare Worker (from the dashboard, no command line)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Create Worker** → name it `inno-admin` → **Deploy**.
2. Open the worker → **Edit code** → delete the sample code → paste the whole of `admin/worker.js` from the website repository → **Deploy**.
3. Note the address, for example `https://inno-admin.<your-subdomain>.workers.dev`. Add `https://inno-admin.<your-subdomain>.workers.dev/inno/auth/callback` as the redirect URI in Entra (step 1.3).
4. Worker → **Settings** → **Variables and Secrets** → add these. Use type **Secret** for the secret ones:

| Name | Type | Value |
|---|---|---|
| `ENTRA_TENANT_ID` | Text | Directory (tenant) ID |
| `ENTRA_CLIENT_ID` | Text | Application (client) ID |
| `ENTRA_CLIENT_SECRET` | **Secret** | Client secret value |
| `ENTRA_ALLOWED_USERS` | Text | Your admin user's Object ID |
| `ENTRA_ALLOWED_EMAILS` | Text | Optional: your sign-in address. If both lists are set, both must match |
| `SESSION_SECRET` | **Secret** | 64 random characters (see below) |
| `GITHUB_TOKEN` | **Secret** | `github_pat_…` |
| `GITHUB_REPO` | Text | `innocent-mbele/innocent-mbele.github.io` |
| `ADMIN_ALLOWED_COUNTRIES` | Text | `AE,ZW` (two-letter codes, comma separated) |
| `SESSION_HOURS` | Text | `2` |

To make `SESSION_SECRET`, run this in PowerShell and copy the output:
```powershell
$b = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

5. Open `https://inno-admin.<your-subdomain>.workers.dev/inno` and sign in.

## 4. Point innocent-mbele.github.io/inno to it

In the admin, open **Settings** → **Admin address**, enter `https://inno-admin.<your-subdomain>.workers.dev/inno` and press **Publish changes**. From then on innocent-mbele.github.io/inno takes you there.

## 5. GitHub Pages must build with Actions

Website repository → **Settings** → **Pages** → **Build and deployment** → **Source** = **GitHub Actions**. Without this, admin changes are saved but the live pages do not update.

## Everyday use

- **Change your photo:** Profile and photo → *Upload a new photo* → choose the shape, drag and zoom → *Use this photo*. Pick the size (small, medium, large) and which part stays in view. The preview shows the result.
- **Add a project:** Projects → *Add a project*. Fill in the fields and use *Add screenshots*. Paint over subscription IDs first and make sure no password, key, token or employer detail shows.
- **Show a project on the home page:** tick *Show on the home page*.
- **Add a link or repository:** Links and repositories → *Add*.
- **Undo a change:** on GitHub open the commit (the admin shows its link) and click **Revert**.
- **Renewals:** the client secret and the GitHub token expire. Create new ones and update them in Cloudflare.

## Changing the admin code

Edit the files in `admin/src/`, then run:
```powershell
python tools/bundle_admin.py
node --test admin/test/worker.test.mjs
```
Paste the new `admin/worker.js` into the Cloudflare editor and deploy.
