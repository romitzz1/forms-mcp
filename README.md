# Enhanced Gravity Forms MCP Server

A Model Context Protocol (MCP) server that lets AI assistants manage WordPress
Gravity Forms through the Gravity Forms REST API v2 — reading and writing
forms and entries, searching, exporting data, and managing templates.

20 tools are exposed, covering core CRUD, advanced multi-field search, bulk
operations, template management, and JSON import/export. See the
[Tool Catalog](#tool-catalog) below.

## Requirements

- Node.js 24 or later (see `.nvmrc`)
- A WordPress site with Gravity Forms and its REST API v2 enabled
- Gravity Forms REST API consumer key/secret

## Quick Start (Claude Desktop, stdio)

### 1. Get API credentials

1. In WordPress admin, go to **Forms → Settings → REST API**.
2. Check **Enabled** to turn on the API.
3. Click **Add Key**, give it a name, and select a user.
4. Copy the **Consumer Key** and **Consumer Secret** — WordPress only shows
   them once.

### 2. Build the server

```bash
git clone <this-repo>
cd forms-mcp
npm install
npm run build
```

### 3. Add it to Claude Desktop

Open Claude Desktop's MCP settings and add a server entry pointing at the
built `dist/cli.js`:

```json
{
  "mcpServers": {
    "gravity-forms": {
      "command": "node",
      "args": ["/absolute/path/to/forms-mcp/dist/cli.js"],
      "env": {
        "GRAVITY_FORMS_BASE_URL": "https://yourwebsite.com",
        "GRAVITY_FORMS_CONSUMER_KEY": "ck_your_key_here",
        "GRAVITY_FORMS_CONSUMER_SECRET": "cs_your_secret_here"
      }
    }
  }
}
```

Use an absolute path — on Windows, forward slashes work fine (e.g.
`C:/Users/you/forms-mcp/dist/cli.js`).

Restart Claude Desktop, then try:

> "Show me all my Gravity Forms"

If Claude can see your forms, you're set.

## Configuration

Copy `.env.example` to `.env` and fill in your values (used when running the
server directly with `npm start`; when embedding in a Claude Desktop config,
set the same variables in the `env` block instead).

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `GRAVITY_FORMS_BASE_URL` | yes | — | Your WordPress site URL |
| `GRAVITY_FORMS_CONSUMER_KEY` | yes | — | REST API consumer key |
| `GRAVITY_FORMS_CONSUMER_SECRET` | yes | — | REST API consumer secret |
| `GRAVITY_FORMS_AUTH_METHOD` | no | `basic` | Only `basic` is currently supported |
| `GRAVITY_FORMS_CACHE_ENABLED` | no | `true` | Enable the SQLite form cache |
| `GRAVITY_FORMS_CACHE_DB_PATH` | no | `./data/forms-cache.db` | Cache database path |
| `GRAVITY_FORMS_CACHE_MAX_AGE_SECONDS` | no | `3600` | How long cached forms are considered fresh |
| `GRAVITY_FORMS_EXPORT_DIR` | no | `./exports` | Directory for `save_to_disk` exports |

The cache also supports `GRAVITY_FORMS_CACHE_AUTO_SYNC`,
`GRAVITY_FORMS_FULL_SYNC_INTERVAL_HOURS`, `GRAVITY_FORMS_MIN_FORM_ID`, and a
few other tuning knobs — see `.env.example` for the full list and
`CLAUDE.md` for what each one does.

## Running the Server

### stdio (default, one process per client)

```bash
npm start        # runs dist/cli.js
npm run dev       # build + run
```

This is what the Quick Start above uses — the server talks to its client
over stdin/stdout.

### Streamable HTTP (one shared server for a team)

Set `MCP_TRANSPORT=http` and the server exposes a Streamable HTTP endpoint
instead of stdio:

```bash
MCP_TRANSPORT=http
MCP_AUTH_TOKEN=a-long-random-string   # required — server refuses to start without it
MCP_HTTP_PORT=9807                    # optional, this is the default
```

Clients connect to `http://<host>:9807/mcp` with an
`Authorization: Bearer <token>` header instead of spawning a local process.
There's also an unauthenticated `GET /health` for liveness checks. This is a
single shared token, not full OAuth — run it on a private network or VPN,
not the open internet.

### Docker (central deployment)

A multi-stage `Dockerfile` and `docker-compose.yml` are included for running
the HTTP mode above in a container:

```bash
cp .env.docker.example .env
# edit .env: set a strong MCP_AUTH_TOKEN and your GRAVITY_FORMS_* credentials
docker compose up -d --build
```

The container runs as a non-root user on Node 24, listens on port `9807`,
and persists the SQLite form cache and exported files in the `gf-cache` and
`gf-exports` named volumes, so they survive restarts and rebuilds. Docker's
`HEALTHCHECK` polls `/health`. Tail logs with `docker compose logs -f`.

## Tool Catalog

All 20 tools, grouped by purpose. Exact input names are hand-authored Zod
schemas in `utils/toolSchemas.ts`.

### Core

- `get_forms` — Get all forms, or a specific form's definition and fields
- `get_entries` — Query entries with filtering, sorting, and pagination
- `submit_form` — Submit a form with full processing (validation, notifications)
- `create_entry` — Create an entry directly, bypassing form processing
- `update_entry` — Update an existing entry
- `delete_entry` — Delete an entry (trash by default, or permanent with `force`)
- `create_form` — Create a new form
- `update_form` — Replace an existing form with a full form definition (`title` and `fields` required)

### Search

- `search_entries_by_name` — Search entries by name across all name fields, automatically
- `search_entries_universal` — Multi-field search (name/email/phone/custom) with AND/OR logic and field targeting
- `get_field_mappings` — Detect a form's field types (name, email, phone, address) to target searches

### Templates

- `list_form_templates` — Browse forms flagged as templates (`-template` suffix)
- `save_form_as_template` — Save an existing form as a reusable template
- `create_form_from_template` — Create a new form from a template, with optional field renames

### Import / Export

- `export_entries_formatted` — Export entries to CSV or JSON with filtering and formatting options
- `export_form_json` — Export a form definition as JSON for backup or migration
- `import_form_json` — Import a form from JSON, with conflict resolution
- `clone_form_with_modifications` — Clone a form with title/field-label modifications

### Bulk

- `process_entries_bulk` — Bulk delete, status-update, or field-update on up to 100 entries at once (requires `confirm: true`)

### Cache

- `get_cache_status` — Inspect the SQLite form cache's health, config, and sync status

## Field Input Names

When submitting or updating entries, use the exact HTML input names from the
form:

- Simple fields: `input_1`, `input_2`
- Complex fields: `input_4_3` (field 4, input 3)
- Name fields: `input_1_3` (first name), `input_1_6` (last name)

Find exact input names by inspecting the form's HTML in your browser's
developer tools.

## Gravity Forms API Format Notes

The REST API returns some values as strings rather than native types:

- `is_active` and `is_trash` are the strings `"1"`/`"0"`, not booleans
- Form IDs are strings (`"123"`), not numbers
- Dates are strings formatted `"YYYY-MM-DD HH:MM:SS"`

## Permissions

The WordPress user behind your API key needs the relevant Gravity Forms
capabilities:

- `gravityforms_view_entries`, `gravityforms_edit_entries`, `gravityforms_delete_entries`
- `gravityforms_create_form`, `gravityforms_edit_forms`, `gravityforms_delete_forms`

## Troubleshooting

### "No forms found" or connection errors

- Base URL must start with `https://`
- Double-check consumer key/secret for typos or stray whitespace
- Confirm the REST API is enabled under Forms → Settings → REST API

### "Module not found" / Claude can't launch the server

- Confirm the path in your MCP config points at `dist/cli.js`
- Run `npm run build` — `dist/` doesn't exist until you do
- Use an absolute path, not a relative one

### Claude doesn't see the tools after setup

- Fully restart Claude Desktop (quit, not just close the window)
- Check your MCP config JSON for syntax errors (trailing commas, etc.)
- Ask Claude "what MCP tools do you have?" to confirm the server connected

### HTTP mode won't start

- `MCP_AUTH_TOKEN` is required when `MCP_TRANSPORT=http`; the process exits
  non-zero without it
- Check nothing else is already bound to `MCP_HTTP_PORT` (default `9807`)

### Debug logging on the WordPress side

- Forms → Settings → Logging → enable "Gravity Forms API" and set it to log
  all messages, then check the logs after a request

## Development

See `CLAUDE.md` for architecture, module layout, and the full development/test
workflow.

```bash
npm install
npm run build
npm test
```

## Related Links

- [Gravity Forms REST API v2 Documentation](https://docs.gravityforms.com/rest-api-v2/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Gravity Forms](https://www.gravityforms.com/)
