# Three Numbers — open agentic website

For one XRPL key, the ledger shows how many commitments it **signed**, **kept** and let
**expire**. Three Numbers reads them straight from a public XRPL node in your browser,
and now has an assistant that answers in plain words: what a key's record is, what the
numbers mean, and what they cannot prove.

It follows the [Open Agentic Web MVP specification](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md):
the agent network is public JSON, it runs in the visitor's browser, and the visitor
chooses the AI provider and pays for it with their own key. The site has no server.

## How it counts

- **Signed**: successful `EscrowCreate` sent by the key.
- **Kept**: successful `EscrowFinish` on an escrow the key created (`Owner` = the key).
- **Expired**: successful `EscrowCancel` on an escrow the key created, possible only after its cancel date.
- Only `tesSUCCESS` transactions count. No memo or escrow content is read: public counter, private content (article 4 of the [bonobo code](https://zenodo.org/records/24176443)).

Live: https://ledenti.github.io/trois-nombres/ (French original without the assistant: `fr/`).

Testnet keys to try: `rGJsjkfmASA2ezXYDpTQJZDp9tRgCJAPhw` (4 / 4 / 0),
`r9eDSQ2Cex3ahuMtwkqMyvrQBNfYEYqzWo` (9 / 6 / 3), `rUuvu1XPgd5GtTgrXQKiwrHq3fb2xiHZMW`
(an oracle: 0 / 0 / 0, but 50 kept and 13 let expire for others). Counts as of 18/11/2026.

## The agent network `three_numbers`

| Agent | Job | Tools |
|---|---|---|
| `reader` (front) | Reads keys, reports the counts, shows a key on the page | `website_read_key`, `website_show_key`, `website_get_page`, `method_guide` |
| `method_guide` | Explains what the counts mean and cannot prove | `website_get_page` |

| Action | Effect | Wraps |
|---|---|---|
| `get_page` | read | `App.page.getState()`: method, limits, networks, what the page shows |
| `read_key` | read | `App.page.lookUp()`: one key's record, page unchanged |
| `show_key` | write | `App.page.show()`: same as the page's Read button |

Nothing can sign, send or change anything on the ledger, so there is no irreversible
action. A busy key is read up to 5,000 transactions and the answer then says it is partial.

Network URL: `<site>/three_numbers`. Other agent sites can call it. They get the
network but not the page's actions (runtime rule), so the network has a third agent,
`ledger_reader`, that reads keys through the public MCP service below. The caller's
visitor sees a consent card naming the service before anything is sent, and only the
address and network go out.

## The MCP service (`mcp/server.mjs`)

Live at **https://three-numbers-mcp.onrender.com/mcp** (free instance: the first call after a quiet spell can take up to a minute).

A read-only [MCP](https://modelcontextprotocol.io) server any agent can use, built on the
same counting code as the page (`script.js`), so every client gets the same numbers.

| Tool | Returns |
|---|---|
| `read_key {address, network}` | the record above, `readOn` (today), `partial`, `found` |
| `explain_method {}` | how each number is counted and what the record cannot show |

Streamable HTTP at `POST /mcp`, plain JSON replies, stateless, CORS open, no keys, no
storage. 30 requests per minute per IP, 60-second cache, 8 reads at a time.

```shell
npm start            # PORT=8787 by default
npm test
```

## Files

`index.html`, `script.js` (page, exports `App.page`), `site.js` (mounts the assistant),
`site-actions.js`, `three_numbers.hocon` (source of the network),
`three_numbers.network.json`, `agent-manifest.json`, `links.json`, `agent-mcp.json`,
`.well-known/` and `bridge/` (generated), `runtime/` (copied unchanged from the
agentify-website skill), `tests/`.

## Build, test, run

```shell
SKILL=../spec/skills/agentify-website
node $SKILL/scripts/build_network.mjs three_numbers.hocon --manifest agent-manifest.json --check
node --test "tests/*.test.mjs"
node $SKILL/scripts/serve_site.mjs . --port 8080
```

Open http://127.0.0.1:8080/, then ⚙ AI model settings: paste an Otari key (an EU key
`otk_v1_eu_…` gets the EU gateway automatically) or use Connect with OpenRouter.

Hosting: any static host that sends `Access-Control-Allow-Origin: *` on the public files
(GitHub Pages does).

Signed matter-x-.
