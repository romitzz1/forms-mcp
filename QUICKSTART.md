<!-- ABOUTME: Task-focused quickstart for running the server in Docker (HTTP) or locally (stdio) -->
<!-- ABOUTME: and wiring Claude Code and Claude Desktop to it, including the mcp-remote bridge. -->

# Quickstart

Two ways to run the server — pick one:

- **[Option A — Docker (shared HTTP server)](#option-a--docker-shared-http-server)** — one container that every machine and teammate points at over the network. Best when you'll use it from more than one place.
- **[Option B — Local (stdio)](#option-b--local-stdio)** — the client launches the server as a subprocess on your machine. Simplest for a single user, no Docker.

Either way, you first need Gravity Forms API credentials.

---

## Step 0 — Get Gravity Forms API credentials

1. In WordPress admin, go to **Forms → Settings → REST API**.
2. Check **Enabled**.
3. Click **Add Key**, name it, and pick a user with permission to manage forms/entries.
4. Copy the **Consumer Key** (`ck_…`) and **Consumer Secret** (`cs_…`) — WordPress shows the secret only once.

Keep these three values handy: your site URL, the consumer key, and the consumer secret.

---

## Option A — Docker (shared HTTP server)

The container runs the server in **HTTP mode**: clients connect to `http://<host>:9807/mcp` with a shared bearer token. Run it on a trusted/private network (LAN or VPN) — the token is a single shared secret, not full OAuth.

### 1. Configure

```bash
git clone <this-repo>
cd forms-mcp
cp .env.docker.example .env
```

Edit `.env` and set:

```dotenv
# A long random secret clients must present. Generate one with:  openssl rand -hex 32
MCP_AUTH_TOKEN=paste-a-long-random-secret-here
GRAVITY_FORMS_BASE_URL=https://your-wordpress-site.com
GRAVITY_FORMS_CONSUMER_KEY=ck_your_consumer_key_here
GRAVITY_FORMS_CONSUMER_SECRET=cs_your_consumer_secret_here
GRAVITY_FORMS_AUTH_METHOD=basic
```

### 2. Launch

```bash
docker compose up -d --build
```

The container runs as a non-root user on Node 24, listens on port `9807`, and persists the form cache and exports in the `gf-cache` / `gf-exports` named volumes (they survive restarts and rebuilds).

Verify it's healthy (this endpoint needs no token):

```bash
curl http://localhost:9807/health        # -> {"status":"ok"}
docker compose logs -f                    # tail logs
```

> **Which host do clients use?** From the Docker host itself, `http://localhost:9807`. From other machines, use the host's LAN address or hostname, e.g. `http://192.168.1.50:9807` or `http://gf-server.local:9807`.

### 3. Connect Claude Code

Register the remote server (replace `HOST` and the token):

```bash
claude mcp add --transport http gravity-forms-enhanced \
  http://HOST:9807/mcp \
  --header "Authorization: Bearer YOUR_MCP_AUTH_TOKEN"
```

Add `--scope user` to make it available in all your projects, or `--scope project` to write it into a shared `.mcp.json` in the repo (default scope is this project only).

Prefer a file? Create `.mcp.json` in your project root (note the `headers` object, not `--header`):

```json
{
  "mcpServers": {
    "gravity-forms-enhanced": {
      "type": "http",
      "url": "http://HOST:9807/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_AUTH_TOKEN"
      }
    }
  }
}
```

Verify:

```bash
claude mcp list        # shows the server + connection status
```

…or run `/mcp` inside a session.

### 4. Connect Claude Desktop

Claude Desktop's built-in **Connectors** UI only supports OAuth, so it can't send a static bearer token. Use the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge, which runs locally over stdio and proxies to your HTTP endpoint. It needs Node.js installed (for `npx`).

Edit `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "gravity-forms-enhanced": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://HOST:9807/mcp",
        "--header",
        "Authorization: Bearer ${AUTH_TOKEN}"
      ],
      "env": {
        "AUTH_TOKEN": "YOUR_MCP_AUTH_TOKEN"
      }
    }
  }
}
```

> The `${AUTH_TOKEN}` + `env` form avoids a known quoting bug where a space inside `--header` gets mangled — don't inline the token directly in the header string. Restart Claude Desktop after saving.

Skip to [Verify it works](#verify-it-works).

---

## Option B — Local (stdio)

Here the client spawns the server on your machine and talks to it over stdin/stdout — no Docker, no token, no network.

### 1. Build the server

```bash
git clone <this-repo>
cd forms-mcp
npm install
npm run build        # produces dist/cli.js
```

### 2. Connect Claude Code

```bash
claude mcp add gravity-forms-enhanced \
  --env GRAVITY_FORMS_BASE_URL=https://your-wordpress-site.com \
  --env GRAVITY_FORMS_CONSUMER_KEY=ck_your_consumer_key_here \
  --env GRAVITY_FORMS_CONSUMER_SECRET=cs_your_consumer_secret_here \
  -- node /absolute/path/to/forms-mcp/dist/cli.js
```

Everything after `--` is the command Claude Code runs. Add `--scope user` to use it across all your projects. Verify with `claude mcp list`.

### 3. Connect Claude Desktop

Edit `claude_desktop_config.json` (paths above) and point it at the built `dist/cli.js`:

```json
{
  "mcpServers": {
    "gravity-forms-enhanced": {
      "command": "node",
      "args": ["/absolute/path/to/forms-mcp/dist/cli.js"],
      "env": {
        "GRAVITY_FORMS_BASE_URL": "https://your-wordpress-site.com",
        "GRAVITY_FORMS_CONSUMER_KEY": "ck_your_consumer_key_here",
        "GRAVITY_FORMS_CONSUMER_SECRET": "cs_your_consumer_secret_here"
      }
    }
  }
}
```

Use an **absolute** path to `dist/cli.js` (on Windows, forward slashes are fine: `C:/Users/you/forms-mcp/dist/cli.js`). Restart Claude Desktop.

---

## Verify it works

In Claude Code (`/mcp` shows the server as connected) or Claude Desktop, ask:

> "Show me all my Gravity Forms"

If Claude lists your forms, you're done.

---

## Troubleshooting

- **Claude can't launch the server / "module not found" (stdio):** the path must point at `dist/cli.js`, not `dist/index.js` (`index.ts` is a library and does nothing when run directly). Re-run `npm run build` if `dist/` is missing.
- **Tools disappear after a rebuild:** MCP connections don't hot-reload. Reconnect — in Claude Code run `/mcp` → reconnect; in Claude Desktop, restart the app. For Docker, `docker compose up -d --build` then reconnect.
- **HTTP server won't start:** `MCP_AUTH_TOKEN` is required in HTTP mode — the server exits if it's missing.
- **401 / connection refused (HTTP):** confirm the `Authorization: Bearer <token>` value matches `MCP_AUTH_TOKEN` exactly, the host/port are reachable (`curl http://HOST:9807/health`), and any firewall allows port `9807`.
- **Rotated the token:** update it in every client config, then reconnect (Claude Code `/mcp`) or restart (Claude Desktop).
- **Change the port:** set `MCP_HTTP_PORT` (and update the compose `ports` mapping + client URLs).

For the full configuration reference and tool catalog, see [README.md](README.md).
