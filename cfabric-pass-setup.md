# Fabric Pass — deployment setup

Step-by-step instructions for deploying Fabric Pass from scratch: a single
server running the app, Postgres, a reverse proxy, and a deploy webhook, all
as Docker Compose services. Images are built by GitHub Actions and published
to GHCR; the server pulls and redeploys on a signed webhook call rather than
being built on directly. See [README.md](README.md) for the application
itself — this file covers infrastructure only.

Follow the steps in order — each one depends on the ones before it.

Sections marked **Implementation notes** are collapsed by default and exist
for whoever (human or AI agent) is doing the actual reproduction — they hold
the non-obvious "why," not just the "what." Skip them on a first read; come
back if something doesn't behave the way the main text says it should.

## Prerequisites

- A DigitalOcean account (or any host that gives you a fresh Ubuntu VM with
  root SSH access — the steps below are DigitalOcean-flavored but not
  DigitalOcean-specific).
- A domain you control, with DNS you can edit. Proxying through Cloudflare
  is recommended (DDoS protection, hides the origin IP) but not required.
- A GitHub repository to host the code and run the CI workflows, with GHCR
  (GitHub Container Registry) available to it — this comes free with the repo.
- A [Resend](https://resend.com) account (or another transactional-email API
  provider) for sending confirmation emails. See [Step 10](#step-10--set-up-email-resend).
- An SSH key pair on the machine you'll administer from. Reuse one you
  already have, or generate one: `ssh-keygen -t ed25519 -C "you@example.com"`.

## Before you start — define your constants

Pick values for everything in this table and substitute them consistently
into every command below. The **Example** column shows a real, working value
where the setting isn't sensitive (region, plan, username), and a
documentation-safe placeholder where it is (IP address).

| Placeholder | Example | What it is |
|---|---|---|
| `<DOMAIN>` | `pass.cfabric.org` | Public hostname the app is served from |
| `<DROPLET_NAME>` | `fabric-pass` | Server name; also used as `COMPOSE_PROJECT_NAME` |
| `<REGION>` | `fra1` | DigitalOcean region slug — pick one close to your users |
| `<DEPLOY_USER>` | `deploy` | Non-root account used for all server access after setup |
| `<APP_DIR>` | `/opt/fabric-pass` | Where the Compose files live on the server |
| `<SSH_HOST_ALIAS>` | `fabric-pass` | Local `~/.ssh/config` `Host` alias for this server |
| `<SSH_KEY>` | `~/.ssh/id_ed25519` | Local SSH key used to reach the server |
| `<DROPLET_IP>` | `203.0.113.10` | The server's public IP (yours will differ — this is a documentation-only example address) |
| `<GITHUB_REPO>` | `constructorfabric/fabric-pass` | The repo this is deployed from |
| `<GHCR_IMAGE>` | `ghcr.io/constructorfabric/fabric-pass` | Where CI publishes images |
| `<RESEND_DOMAIN>` | `cfabric.org` | The domain you verify in Resend and send confirmation emails from |

## Step 1 — Provision the server

Via the DigitalOcean console (or `doctl compute droplet create` if you
prefer the CLI):

1. Name: `<DROPLET_NAME>`.
2. Image: Ubuntu 24.04 LTS.
3. Plan: Basic, 1 vCPU / 1GB RAM / 25GB SSD (~$6/mo) is enough — see the
   swap setup in [Step 4](#step-4--server-base-setup) for why a box this
   small still works comfortably for this app.
4. Region: `<REGION>`.
5. Attach your SSH public key at creation time, so root login works
   immediately with no password ever set.
6. Note the droplet's public IP once it's up — that's your `<DROPLET_IP>`.

## Step 2 — Point DNS at the server

1. At your DNS provider, add an **A record**: `<DOMAIN>` → `<DROPLET_IP>`.
2. If you're proxying through Cloudflare, set SSL/TLS mode to **Full
   (strict)**. Caddy (installed in [Step 6](#step-6--review-the-deployment-files))
   gets its own certificate and terminates real TLS at the origin —
   Cloudflare's default **Flexible** mode instead terminates TLS at its own
   edge and speaks plain HTTP to the origin, which fights with Caddy's
   automatic HTTPS and produces a redirect loop.

## Step 3 — Verify SSH access as root

```bash
ssh root@<DROPLET_IP>
```

Confirm you land in a shell. This root session is only used to bootstrap
the `<DEPLOY_USER>` account below — root login gets disabled once that
account is confirmed working.

## Step 4 — Server base setup

Run everything in this step as root, over the SSH session from Step 3.

### Swap

The smallest droplet plan has under 1GB of RAM — tight for Postgres,
Next.js, Caddy, and the webhook receiver running at once, especially during
a container recreation. A swap file is a cheap OOM safety net:

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo "/swapfile none swap sw 0 0" >> /etc/fstab
sysctl -w vm.swappiness=10
echo "vm.swappiness=10" > /etc/sysctl.d/99-swappiness.conf
```

`vm.swappiness=10` tells the kernel to prefer RAM and only spill to swap
under real pressure, rather than swapping eagerly.

### Docker

Install from Docker's own apt repo, not the older Ubuntu-packaged
`docker.io` — this is what gives you the Compose v2 plugin (`docker compose`,
no hyphen) that the rest of this guide assumes:

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker --version && docker compose version
```

### Create the deploy user

Root login gets disabled later in this step, so every future login and
every container operation goes through this account instead:

```bash
adduser --disabled-password --gecos "" <DEPLOY_USER>
usermod -aG sudo,docker <DEPLOY_USER>
mkdir -p /home/<DEPLOY_USER>/.ssh
cp /root/.ssh/authorized_keys /home/<DEPLOY_USER>/.ssh/authorized_keys
chown -R <DEPLOY_USER>:<DEPLOY_USER> /home/<DEPLOY_USER>/.ssh
chmod 700 /home/<DEPLOY_USER>/.ssh
chmod 600 /home/<DEPLOY_USER>/.ssh/authorized_keys
echo "<DEPLOY_USER> ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/<DEPLOY_USER>
chmod 440 /etc/sudoers.d/<DEPLOY_USER>
```

This reuses the same SSH key root already has — no second key needed.
`docker` group membership means Compose commands never need `sudo`.

<details>
<summary>Implementation notes</summary>

`NOPASSWD` sudo is reasonable for a single-admin personal server where the
account has no password to prompt for in the first place. For a
multi-admin or compliance-sensitive setup, scope this down instead of
copying it verbatim.
</details>

### Firewall (ufw)

Default-deny on incoming; only SSH and the two web ports are reachable from
the public internet. Postgres is deliberately never opened here — see the
note in [Step 6](#step-6--review-the-deployment-files) about why it has no
`ports:` entry in Compose either.

```bash
apt-get install -y ufw fail2ban
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

### fail2ban

Blunts SSH brute-force attempts against the now-internet-facing
`<DEPLOY_USER>` account, using its default `sshd` jail:

```bash
systemctl enable --now fail2ban
```

### Disable root SSH login

**Before running this**, open a *second*, separate SSH session as
`<DEPLOY_USER>` and confirm key auth, passwordless `sudo`, and `docker ps`
all work. Only disable root once that's confirmed — otherwise a mistake
above can lock you out entirely.

```bash
sed -i "s/^PermitRootLogin yes/PermitRootLogin no/" /etc/ssh/sshd_config
systemctl restart ssh
```

Verify from your local machine: `ssh root@<DROPLET_IP>` should now fail
with `Permission denied (publickey)`, while `ssh <DEPLOY_USER>@<DROPLET_IP>`
still works.

## Step 5 — Configure local SSH access

Add to `~/.ssh/config` on your own machine:

```
Host <SSH_HOST_ALIAS>
  HostName <DROPLET_IP>
  User <DEPLOY_USER>
  IdentityFile <SSH_KEY>
```

From here on, every command in this guide that says `ssh <SSH_HOST_ALIAS>`
means "connect to the server as `<DEPLOY_USER>`."

## Step 6 — Review the deployment files

These already exist in the repo under [deploy/](deploy/) — nothing to
create, just know what's there before you copy it to the server:

- **[deploy/docker-compose.yml](deploy/docker-compose.yml)** — four
  services: `postgres` (tuned down for a low-memory box —
  `shared_buffers=128MB`, `max_connections=20`, etc.), `app` (pulled from
  `<GHCR_IMAGE>:latest`), `caddy` (the only service publishing host ports,
  80/443), `webhook` (custom-built, see below).
- **[deploy/Caddyfile](deploy/Caddyfile)** — routes `/deploy-hook*` to the
  webhook service, everything else to `app`.
- **[deploy/webhook/](deploy/webhook)** — a small custom Node HTTP server.
  Verifies GitHub's `X-Hub-Signature-256` over the raw request body (and
  checks the caller against GitHub's published hook IP ranges as defence in
  depth), then runs `docker compose pull app && docker compose up -d app`
  against the host's own Docker daemon via a mounted socket. GitHub itself
  delivers the `workflow_run` event when the build finishes, so a CI push
  turns into a live redeploy with no SSH access needed from CI — and with
  the shared secret never travelling over the wire.
- **[.github/workflows/deploy.yml](.github/workflows/deploy.yml)** — on
  push to `main` (or manual dispatch): builds the root [Dockerfile](Dockerfile),
  pushes `:latest` and `:<commit-sha>` to GHCR, then calls the webhook.

<details>
<summary>Implementation notes</summary>

- Postgres 18's image expects its volume mounted at `/var/lib/postgresql`
  (the parent directory), not `.../data` — mounting at `.../data` makes the
  image treat it as leftover data from an older layout and refuse to start.
- Postgres has no `ports:` entry — it's reachable only over the Compose
  network. If you ever need to expose it for debugging, remember Docker's
  own iptables rules can bypass `ufw`, so `ufw` alone won't protect a
  published Postgres port the way it protects the host's other services.
- `webhook` and `caddy` bind-mount the *whole* `<APP_DIR>` directory
  read-only (`.:/deploy:ro`), not individual files like `.env` or
  `Caddyfile`. A single-file bind mount pins the container to the specific
  inode that existed at mount time; `sed -i`, most editors, and `rsync` all
  write a new file and rename it over the old path rather than editing in
  place, which silently orphans a single-file mount — the container keeps
  seeing the old content forever, even though the file on disk is correct.
  A directory mount doesn't have this failure mode. If you ever see a
  freshly-deployed `app` container with empty environment variables despite
  a correct `.env` on disk, this is almost certainly why — recreate
  `webhook`/`caddy` (`docker compose up -d --force-recreate caddy webhook`)
  and confirm with `docker exec <webhook-container> cat /deploy/.env`.
- The webhook container has host-root-equivalent power via the Docker
  socket mount — anyone who can produce a valid `X-Hub-Signature-256` can
  run arbitrary containers on the server. `DEPLOY_WEBHOOK_SECRET` (see
  Step 8) is the entire access boundary; treat it like a root password.
  The IP allowlist is deliberately *not* a second boundary: it fails open
  when GitHub's published ranges can't be fetched, so that an
  api.github.com outage degrades to signature-only rather than blocking
  every deploy.
- If `<DOMAIN>` is proxied through Cloudflare (this deploy is), the request
  chain is GitHub → Cloudflare → Caddy → webhook, and the address Caddy
  observes is a Cloudflare *edge*, not the caller. The webhook therefore
  reads `CF-Connecting-IP`, which Cloudflare overwrites on every request.
  That header is only trustworthy for traffic that actually traversed
  Cloudflare — the origin IP is reachable directly, so a request sent
  straight to it can forge the header. Accepted deliberately: the allowlist
  is defence in depth, and the signature is the real control. Reading
  `X-Forwarded-For` here instead would reject every genuine delivery.
- `webhook`'s entry file is `server.mjs`, not `server.js` — Alpine's Node
  treats a bare `.js` file as CommonJS by default, and the server uses
  `import` syntax.
- `webhook` runs `docker compose` with `--project-directory /deploy`, which
  auto-loads `/deploy/.env`. This keeps `COMPOSE_PROJECT_NAME` consistent
  between the webhook's nested compose invocation and the server's own
  `<APP_DIR>`, so both operate on the *same* Compose project instead of the
  webhook accidentally spinning up a second stack.
</details>

## Step 7 — Copy the deployment files to the server

```bash
rsync -av deploy/ <SSH_HOST_ALIAS>:<APP_DIR>/
```

A plain sync, not a git clone — these files change rarely, and the server
never needs git or repo access at all.

## Step 8 — Generate secrets

Generate each of these and keep them somewhere durable (a password
manager) — none of them should ever be pasted into a chat window, an AI
tool, or committed to git:

| Secret | Command | Used for |
|---|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` | Postgres auth (hex, so it's safe unescaped inside a connection string) |
| `SESSION_PASSWORD` | `openssl rand -base64 32` | Encrypts the app's session cookie (needs ≥32 characters) |
| `DEPLOY_WEBHOOK_SECRET` | `openssl rand -hex 32` | Secret the deploy webhook verifies GitHub's `X-Hub-Signature-256` against |
| `CONTRIBUTORS_EXPORT_SECRET` | `openssl rand -hex 32` | Only if using the registry sync — see [Step 12](#step-12--optional-contributors-registry-sync) |
| `CONTRIBUTORS_SYNC_SECRET` | `openssl rand -hex 32` | Only if using the registry sync |
| `TRACKS_SYNC_SECRET` | `openssl rand -hex 32` | Required — guards `/internal/tracks/sync`, see README's "Tracks" |

Also register a repository **webhook** on `<GITHUB_REPO>` using the same
value — Settings → Webhooks → Add webhook:

| Field | Value |
|---|---|
| Payload URL | `https://<DOMAIN>/deploy-hook` |
| Content type | `application/json` |
| Secret | the same `DEPLOY_WEBHOOK_SECRET` |
| Events | "Let me select individual events" → **Workflow runs** only |

This is a webhook, not an Actions secret: GitHub delivers the event itself
and signs it, so no workflow step ever has to hold or send the value. The
`ping` GitHub sends on creation should come back **200** — that single
green delivery confirms URL, secret and TLS chain all at once.

## Step 9 — Register the OAuth applications

Each redirect/callback URL must match `<DOMAIN>` exactly, so a fork or a
second environment (staging, a personal dev deploy) needs its own
registration at every provider — credentials can't be shared across
different `<DOMAIN>` values.

**GitHub** — [github.com/settings/developers](https://github.com/settings/developers)
→ New OAuth App:
- Homepage URL: `https://<DOMAIN>`
- Authorization callback URL: `https://<DOMAIN>/auth/github/callback`

**Discord** — [discord.com/developers/applications](https://discord.com/developers/applications)
→ New Application → OAuth2 → add redirect `https://<DOMAIN>/auth/discord/callback`.

**Telegram** — via [@BotFather](https://t.me/botfather): `/newbot` to create
the bot, then its Mini App (not the chat commands) → Bot Settings → Web
Login → add `https://<DOMAIN>/auth/telegram/callback` as an allowed URL.

**LinkedIn** (optional — this app's only optional provider; leave both
values unset below to skip it entirely, see the main README's LinkedIn
section) — via
[linkedin.com/developers/apps](https://www.linkedin.com/developers/apps) →
Create app:
- Requires an existing LinkedIn Company Page to attach the app to.
- Products tab → request **"Sign In with LinkedIn using OpenID Connect"**
  (typically auto-approved, no manual review).
- Auth tab → Authorized redirect URLs → add
  `https://<DOMAIN>/auth/linkedin/callback`.
- Note the Client ID and Client Secret from the same tab.

Note each provider's client ID and secret — they go into the server's
`.env` in [Step 11](#step-11--write-the-servers-env-file).

## Step 10 — Set up email (Resend)

Sending goes through [Resend](https://resend.com)'s HTTPS API, not SMTP.

<details>
<summary>Implementation notes</summary>

DigitalOcean blocks all outbound SMTP-family ports on its droplets by
default — not just the commonly-documented 25/465/587, but also 2525,
confirmed by direct `/dev/tcp` connectivity testing against several
providers' mail-submission hosts. HTTPS (443) is unrestricted, which is why
this app sends over an HTTP API rather than SMTP at all. If you migrate to
a different host that doesn't block these ports, SMTP would work too, but
there's no reason to switch back — the HTTP API has no downside once
you're already using it.
</details>

1. Sign up at [resend.com](https://resend.com) and create an API key.
2. Add `<RESEND_DOMAIN>` in Resend's dashboard and add the DNS records it
   gives you (an MX and an SPF TXT record for the domain, plus a DKIM TXT
   record at `resend._domainkey.<RESEND_DOMAIN>`) at your DNS provider.
   Wait for Resend to show the domain as verified — usually minutes to a
   few hours.
3. **Verify the domain you actually intend to send from, not a subdomain of
   it.** A dedicated sending subdomain (e.g. `send.<RESEND_DOMAIN>`) looks
   appealing — it keeps SPF/DKIM separate from any existing mail setup on
   the root domain — but it's one more domain that has to be separately
   verified before Resend will accept a send from it. Resend rejects a send
   from *any* domain, including a subdomain, that it hasn't verified. The
   simplest path that works on the first try: verify `<RESEND_DOMAIN>`
   itself, and send from `no-reply@<RESEND_DOMAIN>`.
4. The API key becomes `RESEND_API_KEY` in the server's `.env` (next step).
   With it unset, the app logs "would have sent" instead of failing, so you
   can bring the rest of the stack up before Resend is fully verified.

## Step 11 — Write the server's `.env` file

On the server (`ssh <SSH_HOST_ALIAS>`), create `<APP_DIR>/.env`:

```bash
cat > <APP_DIR>/.env <<'EOF'
COMPOSE_PROJECT_NAME=<DROPLET_NAME>
POSTGRES_PASSWORD=<from Step 8>
DEPLOY_WEBHOOK_SECRET=<from Step 8>
APP_URL=https://<DOMAIN>
SESSION_PASSWORD=<from Step 8>
GITHUB_CLIENT_ID=<from Step 9>
GITHUB_CLIENT_SECRET=<from Step 9>
DISCORD_CLIENT_ID=<from Step 9>
DISCORD_CLIENT_SECRET=<from Step 9>
TELEGRAM_CLIENT_ID=<from Step 9>
TELEGRAM_CLIENT_SECRET=<from Step 9>
RESEND_API_KEY=<from Step 10, optional>
# Optional — defaults to no-reply@<RESEND_DOMAIN> if unset
RESEND_FROM_ADDRESS=
# Optional — only needed for the registry sync, see Step 12
CONTRIBUTORS_EXPORT_SECRET=
CONTRIBUTORS_SYNC_SECRET=
TRACKS_SYNC_SECRET=<from Step 8>
# Optional — from Step 9. This app's only optional provider: leave both
# unset to skip LinkedIn entirely (no row on the profile form, /auth/linkedin
# 404s)
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
# Optional — the numeric GitHub id of this deployment's single root user;
# unset means no root user at all. Staged ahead of IDEA-011's roles work.
ROOT_GITHUB_ID=
EOF
chmod 600 <APP_DIR>/.env
```

Don't paste real secret values into a chat tool or an AI agent's context to
produce this file. Type them directly at the terminal, e.g. with
`read -sp`, or paste from a password manager straight into the SSH session.

<details>
<summary>Implementation notes</summary>

If scripting this non-interactively (an agent driving the terminal, a
provisioning tool), remember `ssh` needs a `-t` flag whenever the remote
command uses `read -p`/`read -sp` — without a pseudo-terminal, those
prompts never display, and the connection appears to hang forever with no
error, indistinguishable from a network stall.
</details>

## Step 12 — (Optional) Contributors registry sync

Fabric Pass can mirror three columns of its `contributors` table to and
from a YAML file in another repository, so an admin can promote/alias
contributors by editing a file instead of touching the database directly.
Full design in [README.md's "Contributors registry sync"](README.md#contributors-registry-sync);
setup:

1. In the target repo, add the YAML file you'll sync to/from (seed it with
   an empty list, e.g. `contributors: []`, so the first export's diff has a
   tracked baseline).
2. Mint a fine-grained GitHub PAT scoped to just that repo, `Contents: Read
   and write` (via GitHub's web UI — there's no API for creating one).
   Store it as a secret on `<GITHUB_REPO>` (e.g. `gh secret set
   CF_INTERNAL_PAT`).
3. Add a minimal workflow in the target repo that POSTs the file's content
   to `https://<DOMAIN>/internal/contributors/sync` on every push, bearer-
   authenticated with `CONTRIBUTORS_SYNC_SECRET`.
4. `<GITHUB_REPO>`'s own `.github/workflows/export-contributors.yml` calls
   `GET /internal/contributors/export` (authenticated with
   `CONTRIBUTORS_EXPORT_SECRET`) on a schedule and commits the result back
   using the PAT from step 2.
5. Set both `CONTRIBUTORS_EXPORT_SECRET` and `CONTRIBUTORS_SYNC_SECRET`
   (generated in Step 8) in the server's `.env`.

## Step 13 — First bring-up

Before any app image has been published, bring up everything except `app`:

```bash
ssh <SSH_HOST_ALIAS>
cd <APP_DIR>
docker compose up -d --no-deps postgres webhook caddy
```

`--no-deps` matters: `caddy` depends on `app`, and without this flag
Compose would try to pull `app`'s image too — which doesn't exist in GHCR
yet, and would fail the whole command. `app` itself refuses to start with
any environment variable missing or empty, so it stays down until the
OAuth values from Step 9 are actually in place.

Verify:

```bash
# Unsigned, and from an address outside GitHub's published hook ranges:
curl -i -X POST https://<DOMAIN>/deploy-hook -d '{}'   # expect 403

# Signed correctly but still not from GitHub — the allowlist rejects it first:
BODY='{}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "<DEPLOY_WEBHOOK_SECRET>" | awk '{print $2}')"
curl -i -X POST https://<DOMAIN>/deploy-hook -d "$BODY" \
  -H "X-Hub-Signature-256: $SIG" -H 'X-GitHub-Event: ping'   # expect 403
```

Both are expected to be **403** from your own machine — that *is* the
allowlist working.

`403` only applies once GitHub's hook ranges have actually loaded. If
api.github.com was unreachable at startup the check fails open by design
(see the note in Step 6), and the same two requests return **401** for the
unsigned one and **200** for the correctly signed `ping` instead — the
signature still holds, which is the point. Either pattern is healthy; a
`200` on the *unsigned* request never is.

The real end-to-end check is GitHub's own "Recent Deliveries" tab on the
webhook created in Step 8, where the `ping` should show 200.

The 202 case will still fail to actually pull anything yet (no image
published) — that's expected at this point. Also confirm Caddy got a
certificate: `curl -I https://<DOMAIN>/` should return real TLS, not a
certificate error.

## Step 14 — First real deploy

Push to `main` (or trigger the workflow manually). GitHub Actions builds
the image, publishes it to GHCR, and calls the deploy webhook, which brings
`app` up for the first time.

GitHub sometimes creates a brand-new container package as **private** by
default. If the server pulls without any registry credentials configured
(this setup doesn't configure any), the pull will fail until you flip it to
public: on GitHub, go to the package → **Settings** → **Danger Zone** →
**Change visibility**. There's no REST/CLI endpoint for this — it has to be
done once, by hand, in the web UI.

## Step 15 — Verify

- `curl -I https://<DOMAIN>/` → `200`, serving the real sign-in page.
- `ssh <SSH_HOST_ALIAS> "cd <APP_DIR> && docker compose logs app"` shows
  every migration applied and `next start` ready.
- Sign in with GitHub at least once: a fresh contributor has no Name/Email
  yet, so sign-in lands on `/profile` already open in edit mode — link
  Discord and Telegram from there, end to end, not just "the page loads."
- Fill in Name and Email, then trigger a real confirmation email (click
  Confirm) and check it actually arrives — this is the one piece Step 13's
  curl checks can't cover, since it depends on Resend's domain verification
  from Step 10 having actually completed.

## Common pitfalls

- **A freshly-deployed `app` container has empty environment variables,
  even though `.env` on disk is correct.** See the bind-mount note under
  [Step 6](#step-6--review-the-deployment-files) — recreate `webhook` and
  `caddy`, not just `app`.
- **Confirmation emails never arrive, with no error in the logs.** Check
  Resend's dashboard for the domain's verification status — an unverified
  sending domain is rejected by Resend itself, not by this app, so nothing
  in `docker compose logs app` will show it unless `RESEND_API_KEY` is set
  and the request actually reaches Resend.
- **`docker compose up -d --no-deps ...` still tries to build/pull `app`.**
  Double-check `--no-deps` is actually present — `caddy`'s `depends_on`
  will otherwise pull it in.
- **An SSH one-liner with `read -p` hangs with no output.** Add `-t` to the
  `ssh` command — see the note under [Step 11](#step-11--write-the-servers-env-file).

## Recommended, not yet covered above

- A nightly `pg_dump` backup timer — this guide gets Postgres running, but
  doesn't set up backups. Worth adding before this holds anything you'd
  mind losing.
