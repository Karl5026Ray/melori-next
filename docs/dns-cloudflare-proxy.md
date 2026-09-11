# DNS: keep melorimusic.org behind Cloudflare's proxy

**Short version:** in Cloudflare, the records for `melorimusic.org`, `www.melorimusic.org`,
`melori.org` and `www.melori.org` must stay **Proxied (orange cloud)**, with SSL/TLS mode
**Full (strict)**. Vercel will show a "Proxy Detected" warning on those domains. That warning
is expected. Do not "fix" it.

## Why (2026-09-11)

Several Nigerian mobile carriers intermittently block Vercel's shared address `76.76.21.21`.
It is a long-running, widely reported problem, and it was still happening in September 2026.
A site whose apex record points straight at that address simply fails to load on those
networks, while it works everywhere else.

Until early September 2026 `melorimusic.org` ran through Cloudflare's proxy, so visitors
connected to Cloudflare's addresses and Nigerian friends could use the site. At some point
the records were switched to "DNS only", most likely to clear Vercel's "Proxy Detected"
warning. From then on the apex resolved to `76.76.21.21`, and Nigeria went dark.

The evidence from the Supabase edge logs: Nigerian visitors on Glo Mobile appear on
2026-09-05, and none appear afterwards. Over the same days the sign-up page's hero image
(served from Supabase Storage, so a visit to the page shows up in those logs) was loaded
from the US, India, South Africa, the UK, China, Turkey and others. Not once from Nigeria.

`www` does not save us. Its CNAME to `cname.vercel-dns.com` resolves to different Vercel
addresses, but Vercel redirects `www` to the apex. So visitors still end up on
`76.76.21.21`.

## What the proxy changes in the app

Vercel overwrites `x-forwarded-for` with whoever connected to it. Behind the proxy that is a
Cloudflare edge server. `src/lib/clientIp.ts` recovers the real visitor from
`cf-connecting-ip`, but only when the connection provably came from a Cloudflare range. All
rate limiters go through it. If Cloudflare publishes new ranges, add them there.

## If the site "can't be reached" from one country again

1. Check the Cloudflare audit log (Manage Account → Audit Log) for DNS record changes.
2. Check that the apex record still shows the orange cloud.
3. Query the Supabase edge logs by `request.cf.country` for loads of
   `/storage/v1/object/public/images/site/`. If other countries load it and the affected
   country doesn't, the problem is network reachability, not the app.
