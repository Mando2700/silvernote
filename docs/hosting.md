# Hosting

| Piece | Where | Notes |
|---|---|---|
| Website | Vercel project `silvernote` (team `michalmmm2007-4784s-projects`), region `dub1`, https://silvernote.markets | Hobby (free) plan. Every push to `main` deploys. Does no background work (see below), which keeps it within the Hobby limits. |
| Domain `silvernote.markets` | Registered at Vercel (renews automatically), Vercel nameservers | `www.silvernote.markets` (308) and `silvernote-dusky.vercel.app` (307) redirect to it. |
| Background work | GitHub Actions, `.github/workflows/worker.yml` | Repository secrets hold the same settings. |
| Database and sign-in | Supabase project `eyvhgsjcqxogxzxmufvl` (eu-west-1) | Redirect URLs allow `silvernote.markets` and `silvernote.netlify.app`. |
| Standby host | Netlify site `silvernote` (team `mando2700`), https://silvernote.netlify.app | Free plan, environment variables set. Not linked to Git, so it only changes when deployed by hand. Slower: its functions run in us-east-2, far from the database. |

## History

- 2026-10-14 to 2026-11-12: Vercel paused the team for exceeding Hobby fair use (Fluid Provisioned Memory),
  caused by the full-market price sweep running on Vercel every few minutes. The sweep and the other jobs
  moved to GitHub Actions, and the site ran on Netlify in the meantime.
- 2026-11-15: back on Vercel. `silvernote.markets` was added back to the project, the `vercel.app` redirect
  restored, `www` added as a redirect, and the domain's custom (Netlify) nameservers removed so it uses
  Vercel's again (the registry took about 47 minutes).

## Deploying to Netlify (if Vercel is unavailable again)

From a clean export of `main`, so untracked files such as `.env.local` are never uploaded. Build on
Netlify's servers, not locally: a build made on macOS ships the wrong `sharp` binaries and logos break.

```bash
rm -rf /tmp/silvernote-export && mkdir /tmp/silvernote-export && git archive main | tar -x -C /tmp/silvernote-export
```

Then deploy that folder with the Netlify MCP's `deploy-site` command (it uploads the source and builds
remotely), or link the repository in Netlify → Site configuration → Build & deploy.

To point the domain at Netlify: Vercel → Domains → `silvernote.markets` → Nameservers → set to
`dns1.p06.nsone.net`, `dns2.p06.nsone.net`, `dns3.p06.nsone.net`, `dns4.p06.nsone.net` (Netlify DNS zone
`6ad2cc7c783d54e0b904e1b5` already points apex and `www` at the site), and remove the domain from the
Vercel project. Reverse those two steps to come back.
