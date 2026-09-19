# Gian Remote

Remote Server and Remote Web are one independently built and deployed product.
Development happens in GianDev. `.gian-source.json` records the exact source
commit, shared package snapshots and file hashes. Do not hand-edit these
snapshots in the distribution repository.

## Local source checks

Requires Node 24 and pnpm 10.33.2:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

The workspace contains remote-server, remote-web, remote-protocol, shared and
chat-ui. It does not require a checkout of Gian, Electron or any Provider Proxy.
GianDev retains the shared source-scan and Host/Web cross-product integration
tests. Public Remote CI runs all Remote package tests and deployment-script
regression, and builds/boots the real container.

## Stable release

`release.json` owns the Remote product version. Its version is independent of
the Desktop version and the communication protocol. Update it in GianDev,
export a committed revision, review/sync that output to this repository and
create an immutable `vX.Y.Z` tag on main.

Run **Release Remote** on main with that tag. It checks the exact tag commit,
builds and tests native linux/amd64 and linux/arm64 images, pushes those tested
images, creates their multi-platform manifest, and publishes a stable GitHub
Release with `remote-release.json` and `SHA256SUMS`. That receipt binds source,
image digest and the database migration fingerprint. A published tag cannot
be rebuilt through this release entrypoint. Deployment retries consume the
published receipt and never rebuild an image.

Release Remote directly calls Deploy Remote after publication. A release
created with GITHUB_TOKEN does not normally trigger another event workflow;
this direct call avoids a missing deployment. Deploy Remote also handles
human-published stable releases and manual retries. Drafts and prereleases
are not deployed; only the latest published stable release is eligible.
See [GitHub workflow trigger behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

## One-time cloud host setup

Use a dedicated Linux host/account with Docker Engine, Docker Compose v2,
`flock`, tar and SSH. The account must be allowed to run Docker. No inbound
Agent or workspace access is required. The server must be able to pull the
image from GHCR: either make the image package public or configure a read-only
registry login on that machine. CI does not copy a registry token to it.

Choose a dedicated directory, for example `/opt/gian-remote`. It must be
writable by the deployment account. Install `runtime.env` there with mode
0600, using `runtime.env.example` as the field reference. Set a random admin
token and the real HTTPS origin; do not put those secrets in Git or Actions
logs. The data volume preserves pairing records and the server identity.

If the machine already runs Remote outside this Compose project, first plan
the migration of its complete stopped data directory (including SQLite/WAL
and server-identity.json) into the managed volume. A fresh empty volume creates
a new identity. This workflow does not stop or adopt an unrelated existing
service automatically.

Remote binds only `127.0.0.1:8787` on the host by default. Configure your HTTPS
reverse proxy to forward HTTP and WebSocket upgrades there; set appropriate
WebSocket timeouts. `GIAN_REMOTE_TRUSTED_PROXY=1` is appropriate only if that
proxy overwrites forwarding headers and untrusted clients cannot bypass it.
The workflow does not change DNS, certificates, firewalls or an existing proxy.

In GitHub configure environment **remote-production**:

| Kind | Name | Value |
|---|---|---|
| Variable | REMOTE_SSH_HOST | Cloud host DNS name or IPv4 address |
| Variable | REMOTE_SSH_USER | Dedicated deployment user |
| Variable | REMOTE_SSH_PORT | SSH port; default 22 |
| Variable | REMOTE_DEPLOY_DIR | Dedicated absolute directory |
| Secret | REMOTE_SSH_PRIVATE_KEY | Deployment SSH private key |
| Secret | REMOTE_SSH_KNOWN_HOSTS | Independently verified OpenSSH known_hosts entry (include port syntax for non-22) |

Set repository variable **REMOTE_DEPLOY_ENABLED=true** only after the host and
these settings are ready. Without it deployment is disabled, while source
checks and releases remain usable. Environment reviewer rules, if configured,
will deliberately pause each deployment; omit required reviewers if automatic
deployment after an authorized stable release is desired.

## Deployment and failure handling

The runner verifies the published receipt/tag, uses pinned SSH host keys,
uploads the versioned compose/deployment scripts, then asks the host to pull
the exact `ghcr.io/richlogic/gian-remote@sha256:...` image. It uses a deployment
lock, stops the previous service, backs up the stopped data volume, and starts
the candidate. A short interruption is expected; existing clients reconnect.
The host's healthcheck validates the running source revision; release CI also
checks the served Web page. The `current` symlink advances only after health.

If health fails with an unchanged migration set, the script restarts the
previous image and still returns failure to CI. If migrations changed, or on
the first deployment, it stops the failed service and requests manual recovery.
It never automatically restores a database backup, overwrites the identity,
deletes volumes or removes old release images. Backups live in the deployment
directory and require an operator retention policy and restricted access.
Confirm public HTTPS and real device reconnection after the first deployment;
local/container health alone cannot prove the cloud network route.

## Protocol rollout

New Host/Web exchange an encrypted hello after the cryptographic handshake.
The selected protocol and capabilities are bound to the device, connection and
Host generation. Explicit negotiation errors or connection failure never fall
back. To preserve already deployed Hosts that ignore hello, Web permits a
bounded 1.5-second silent-peer fallback to the existing legacy behavior. Old
Web clients may send their first business command to a new Host without hello.
This transition is not proof that arbitrary historical peers are compatible.
Remove it only as a separately planned compatibility break.

Deploying Remote does not update the user's Gian Desktop. The paired Host
change must reach a Gian release for new connections to report negotiated mode.
