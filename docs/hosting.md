# Hosting

| Piece | Where | Notes |
|---|---|---|
| Website | Netlify, site `silvernote` (team `mando2700`), https://silvernote.netlify.app | Free plan. Environment variables set in Netlify (13 keys, same as `.env.example`). |
| Domain `silvernote.markets` | Registered at Vercel (renews automatically) | Netlify DNS zone ready (apex and `www` → the Netlify site). Goes live once the nameservers are switched to Netlify's (step 5 below). |
| Background work | GitHub Actions, `.github/workflows/worker.yml` | Repository secrets hold the same settings. |
| Database and sign-in | Supabase project `eyvhgsjcqxogxzxmufvl` (eu-west-1) | Unchanged by the move. |
| Old host | Vercel project `silvernote` (team `michalmmm2007-4784s-projects`) | Paused for Hobby fair use (Fluid Provisioned Memory) from 2026-10-14 to 2026-11-12. Left intact. |

## Deploying to Netlify

The site isn't linked to the Git repository, so a push doesn't deploy it. From a clean export of `main`
(so untracked files such as `.env.local` are never uploaded):

```bash
rm -rf /tmp/silvernote-export && mkdir /tmp/silvernote-export && git archive main | tar -x -C /tmp/silvernote-export
```

```bash
cd /tmp/silvernote-export && npx netlify-cli deploy --prod --build --site a70df2ed-538b-4055-a238-820ed2b11169
```

Or link the repository once in Netlify → Site configuration → Build & deploy → Link repository, after
which every push to `main` deploys.

## What changed on 2026-10-17, and how to undo it

Vercel DNS records for `silvernote.markets` before the move:

| Name | Type | Value |
|---|---|---|
| (apex) | ALIAS | `429e470e5c0de818.vercel-dns-017.com` |
| `*` | ALIAS | `cname.vercel-dns-017.com.` |
| (apex) | CAA | `0 issue "pki.goog"`, `0 issue "sectigo.com"`, `0 issue "letsencrypt.org"` (kept) |

Vercel project `silvernote` domains before the move: `silvernote.markets`, and `silvernote-dusky.vercel.app`
redirecting to it (307).

Steps taken:

1. Created the Netlify site and set its environment variables.
2. Added `silvernote.markets` (with `www.silvernote.markets` as an alias) to the Netlify site.
3. Removed `silvernote.markets` from the Vercel project (the domain itself stays in the Vercel account),
   after turning off the `silvernote-dusky.vercel.app` → `silvernote.markets` redirect, which blocked it.
4. Created a Netlify DNS zone for `silvernote.markets` (zone `6ad2cc7c783d54e0b904e1b5`), with apex and
   `www` pointing at the site. Vercel refuses DNS record edits while the team is paused, so the records
   on Vercel are unchanged.
5. Pending: Vercel → Domains → `silvernote.markets` → Nameservers → set to `dns1.p06.nsone.net`,
   `dns2.p06.nsone.net`, `dns3.p06.nsone.net`, `dns4.p06.nsone.net`. Netlify then issues the HTTPS
   certificate (Netlify → Domain management → HTTPS → Verify DNS configuration if it doesn't start).
   The CAA records aren't copied; without any, every certificate authority is allowed.

To go back to Vercel (once its pause has ended):

1. Vercel → Domains → `silvernote.markets` → Nameservers: set back to `ns1.vercel-dns.com` and
   `ns2.vercel-dns.com` (only if step 5 was done; the old Vercel records above are still there).
2. Vercel → project `silvernote` → Settings → Domains: add `silvernote.markets`, and set
   `silvernote-dusky.vercel.app` to redirect to it (307).
3. Redeploy the latest `main` on Vercel.
4. Netlify → site `silvernote` → Domain management: remove `silvernote.markets`; Netlify → Domains:
   delete the `silvernote.markets` zone; or delete the site.
