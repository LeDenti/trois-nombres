// Three Numbers: the page script. It reads one XRPL key's commitments straight from a
// public node and shows three counts: signed, kept, expired.
// The page's own form and the assistant (site-actions.js) call the same App.page methods.

/**
 * The XRPL networks this page can read, with their public node and explorer.
 */
export const NETWORKS = {
  testnet: {
    label: "Testnet",
    node: "wss://s.altnet.rippletest.net:51233",
    explorer: "https://testnet.xrpl.org/transactions/",
  },
  mainnet: {
    label: "Mainnet",
    node: "wss://s2.ripple.com",
    explorer: "https://livenet.xrpl.org/transactions/",
  },
};

/**
 * An XRPL classic address: "r" then 24 to 34 base58 characters.
 */
export const ADDRESS_PATTERN = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

/**
 * Seconds between the Unix epoch and the XRPL epoch (2000-01-01).
 */
const RIPPLE_EPOCH = 946684800;

/**
 * Stop reading after this many transactions, so a busy mainnet account cannot hang the
 * page. The result then says it is partial.
 */
export const MAX_TRANSACTIONS = 5000;

/**
 * Timeline rows the assistant gets: the newest ones. The page shows all of them.
 */
export const TIMELINE_FOR_AGENT = 20;

/**
 * How the page counts, as the page states it. The read action returns this text.
 */
export const METHOD = {
  signed: "Commitments signed: successful EscrowCreate transactions sent by the key.",
  kept: "Kept: successful EscrowFinish transactions on an escrow the key created (Owner = the key), whoever sent them.",
  expired: "Expired: successful EscrowCancel transactions on an escrow the key created, which XRPL only allows after the escrow's cancel date.",
  live: "Open on the ledger: escrows of the key that still exist now.",
  defenders: "Designated defenders: entries in the key's SignerList (multi-signers).",
  forOthers: "For others: escrows created by other keys that this key finished (kept) or cancelled (let expire).",
  onlySuccess: "Only transactions with result tesSUCCESS count.",
  private: "No memo and no escrow content is read or shown: the counter is public, the content stays private (article 4 of the bonobo code).",
};

/**
 * Today's date in UTC, read from the clock each time, as an ISO date and as text.
 *
 * :return: {date, text}.
 */
export function today() {
  const now = new Date();
  return {
    date: now.toISOString().slice(0, 10),
    text: now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
  };
}

/**
 * What the page does not do. The read action returns this list so the assistant can say so.
 */
export const NOT_SUPPORTED = [
  "It does not know who owns a key or link a key to a person.",
  "It does not show memos, amounts, conditions or what a commitment was about.",
  "It does not give a score, a rating or a verdict: it counts acts on the ledger.",
  "It does not sign, send or change anything on the ledger.",
  "It reads only XRPL Testnet and Mainnet, not other blockchains.",
];

/**
 * Turn raw account_tx entries into the page's counts and timeline. Pure function, so
 * tests can check every rule without a node.
 *
 * :param address: The key being read.
 * :param txs: account_tx "transactions" entries, oldest first.
 * :param escrows: account_objects of type escrow that still exist.
 * :param signerLists: account_objects of type signer_list.
 * :param network: A NETWORKS key.
 * :return: The record the page and the assistant show.
 */
export function summarize(address, txs, escrows, signerLists, network) {
  let signed = 0;
  let kept = 0;
  let expired = 0;
  let keptForOthers = 0;
  let expiredForOthers = 0;
  const rows = [];
  for (const entry of txs) {
    const tx = entry.tx || entry.tx_json || {};
    const meta = entry.meta || {};
    if (meta.TransactionResult !== "tesSUCCESS") {
      continue;
    }
    const type = tx.TransactionType;
    if (!type || !type.startsWith("Escrow")) {
      continue;
    }
    const when = entry.close_time_iso ? new Date(entry.close_time_iso) : new Date((tx.date + RIPPLE_EPOCH) * 1000);
    const hash = tx.hash || entry.hash;
    if (type === "EscrowCreate" && tx.Account === address) {
      signed++;
      rows.push({ when, act: "Commitment signed", state: null, hash, seq: tx.Sequence || tx.TicketSequence });
    } else if (type === "EscrowFinish" && tx.Owner === address) {
      kept++;
      rows.push({ when, act: "Commitment kept", state: "kept", hash, seq: tx.OfferSequence });
    } else if (type === "EscrowCancel" && tx.Owner === address) {
      expired++;
      rows.push({ when, act: "Commitment expired", state: "expired", hash, seq: tx.OfferSequence });
    } else if (type === "EscrowFinish" && tx.Account === address) {
      keptForOthers++;
    } else if (type === "EscrowCancel" && tx.Account === address) {
      expiredForOthers++;
    }
  }
  // The state of each signed commitment, found through the escrow's sequence number.
  const closed = new Map();
  for (const row of rows) {
    if (row.state) {
      closed.set(row.seq, row.state);
    }
  }
  for (const row of rows) {
    if (!row.state) {
      row.state = closed.get(row.seq) || "open";
    }
  }
  rows.sort((a, b) => b.when - a.when);
  const signerList = signerLists[0];
  const explorer = NETWORKS[network].explorer;
  return {
    address: address,
    network: network,
    signed: signed,
    kept: kept,
    expired: expired,
    openOnLedger: escrows.length,
    defenders: signerList ? (signerList.SignerEntries || []).length : 0,
    keptForOthers: keptForOthers,
    expiredForOthers: expiredForOthers,
    transactionsRead: txs.length,
    timeline: rows.map((row) => ({
      date: row.when.toISOString(),
      dateText: row.when.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC",
      act: row.act,
      state: row.state,
      hash: row.hash,
      // Made here so no model shortens a hash itself.
      hashShort: `${row.hash.slice(0, 8)}…${row.hash.slice(-8)}`,
      link: explorer + row.hash,
    })),
  };
}

/**
 * One WebSocket connection to an XRPL node, with request/response matching.
 */
export class NodeClient {
  /**
   * :param url: The node's wss:// address.
   * :param timeoutMs: How long to wait for each answer.
   */
  constructor(url, timeoutMs = 20000) {
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.seq = 0;
    this.pending = new Map();
  }

  /**
   * Open the connection once.
   *
   * :return: A promise that resolves when the socket is open.
   */
  open() {
    if (this.socket && this.socket.readyState === 1) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      const timer = setTimeout(() => {
        reject(new Error(`The node ${this.url} did not answer.`));
        try { socket.close(); } catch (error) { /* already closed */ }
      }, this.timeoutMs);
      socket.onopen = () => { clearTimeout(timer); this.socket = socket; resolve(); };
      socket.onerror = () => { clearTimeout(timer); reject(new Error(`The node ${this.url} did not answer.`)); };
      socket.onclose = () => {
        for (const [, waiting] of this.pending) {
          waiting.reject(new Error("The connection to the node closed."));
        }
        this.pending.clear();
        this.socket = null;
      };
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        const waiting = this.pending.get(message.id);
        if (!waiting) {
          return;
        }
        this.pending.delete(message.id);
        if (message.status === "success") {
          waiting.resolve(message.result);
        } else {
          const error = new Error(message.error_message || message.error || "The node returned an error.");
          error.code = message.error;
          waiting.reject(error);
        }
      };
    });
  }

  /**
   * Send one command and wait for its result.
   *
   * :param command: The XRPL command object, without id.
   * :return: The result object.
   */
  async request(command) {
    await this.open();
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The node ${this.url} did not answer in time.`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, ...command }));
    });
  }
}

/**
 * The page: its form, its result panels and the read the form and the assistant share.
 */
export class Page {
  /**
   * :param doc: The page document.
   * :param clientFor: Returns a NodeClient-like object for a node URL. Tests pass a fake.
   */
  constructor(doc, clientFor) {
    this.doc = doc;
    this.clientFor = clientFor;
    this.clients = new Map();
    this.shown = null;
    this.status = "";
    this.version = 0;
  }

  /**
   * Find one element of the page by id.
   *
   * :param id: The element id.
   * :return: The element.
   */
  el(id) {
    return this.doc.getElementById(id);
  }

  /**
   * Check an address and a network without reading anything.
   *
   * :param address: The key the visitor gave.
   * :param network: A NETWORKS key.
   * :return: {ok: true} or {ok: false, reason, field}.
   */
  check(address, network) {
    if (typeof address !== "string" || !ADDRESS_PATTERN.test(address.trim())) {
      return { ok: false, field: "address", reason: "This is not an XRPL address: it starts with r and has 25 to 35 characters." };
    }
    if (!Object.hasOwn(NETWORKS, network)) {
      return { ok: false, field: "network", reason: "The network must be testnet or mainnet." };
    }
    return { ok: true };
  }

  /**
   * Read a key's record from the ledger without changing the page.
   *
   * :param address: The key.
   * :param network: A NETWORKS key.
   * :param progress: Optional callback with the number of transactions read so far.
   * :return: {ok: true, record, partial} or {ok: false, reason}.
   */
  async lookUp(address, network, progress = null) {
    const checked = this.check(address, network);
    if (!checked.ok) {
      return checked;
    }
    const key = address.trim();
    const node = NETWORKS[network].node;
    if (!this.clients.has(node)) {
      this.clients.set(node, this.clientFor(node));
    }
    const client = this.clients.get(node);
    let txs;
    let escrows;
    let signerLists;
    let partial = false;
    try {
      const read = await Promise.all([
        this.allTransactions(client, key, progress),
        this.objects(client, key, "escrow"),
        this.objects(client, key, "signer_list"),
      ]);
      txs = read[0].transactions;
      partial = read[0].partial;
      escrows = read[1];
      signerLists = read[2];
    } catch (error) {
      if (error.code === "actNotFound") {
        return {
          ok: true,
          found: false,
          note: `This key does not exist on ${NETWORKS[network].label}: it has never been funded there.`,
          record: summarize(key, [], [], [], network),
          partial: false,
          readOn: today(),
        };
      }
      return { ok: false, reason: error.message || "The node could not be read." };
    }
    return { ok: true, found: true, record: summarize(key, txs, escrows, signerLists, network), partial: partial, readOn: today() };
  }

  /**
   * Read every transaction of a key, oldest first, up to MAX_TRANSACTIONS.
   *
   * :return: {transactions, partial}.
   */
  async allTransactions(client, account, progress) {
    const out = [];
    let marker;
    do {
      const result = await client.request({
        command: "account_tx",
        account,
        ledger_index_min: -1,
        ledger_index_max: -1,
        limit: 400,
        forward: true,
        marker,
      });
      out.push(...(result.transactions || []));
      marker = result.marker;
      if (progress) {
        progress(out.length);
      }
    } while (marker && out.length < MAX_TRANSACTIONS);
    return { transactions: out, partial: Boolean(marker) };
  }

  /**
   * Read every ledger object of one type that a key owns.
   */
  async objects(client, account, type) {
    const out = [];
    let marker;
    do {
      const result = await client.request({ command: "account_objects", account, type, limit: 400, marker });
      out.push(...(result.account_objects || []));
      marker = result.marker;
    } while (marker);
    return out;
  }

  /**
   * Read a key and show it on the page, as the page's "Read" button does.
   *
   * :param address: The key.
   * :param network: A NETWORKS key.
   * :return: The look-up result, with the page's new version.
   */
  async show(address, network) {
    const checked = this.check(address, network);
    if (!checked.ok) {
      this.setStatus(checked.reason, true);
      return checked;
    }
    const key = address.trim();
    this.el("k").value = key;
    this.el("net").value = network;
    this.el("go").disabled = true;
    this.el("res").hidden = true;
    this.el("tl").hidden = true;
    this.setStatus("Connecting to the node…", false);
    let result;
    try {
      result = await this.lookUp(key, network, (count) => this.setStatus(`${count} transactions read…`, false));
    } finally {
      this.el("go").disabled = false;
    }
    if (!result.ok) {
      this.shown = null;
      this.version++;
      this.setStatus(result.reason, true);
      return { ...result, version: this.version };
    }
    this.shown = { ...result.record, found: result.found, partial: result.partial };
    this.version++;
    this.render(result);
    try {
      if (typeof location !== "undefined") {
        location.hash = key;
      }
    } catch (error) { /* no history in this context */ }
    return { ...result, version: this.version };
  }

  /**
   * Draw a record into the result panels.
   *
   * :param result: A successful look-up result.
   */
  render(result) {
    const record = result.record;
    const fmt = (n) => new Intl.NumberFormat("en-GB").format(n);
    this.el("who").textContent = record.address;
    this.el("n1").textContent = fmt(record.signed);
    this.el("n2").textContent = fmt(record.kept);
    this.el("n3").textContent = fmt(record.expired);
    this.el("n4").textContent = fmt(record.openOnLedger);
    this.el("n5").textContent = fmt(record.defenders);
    this.el("n6").textContent = fmt(record.keptForOthers);
    this.el("n7").textContent = fmt(record.expiredForOthers);
    this.el("res").hidden = false;
    const body = this.el("tb");
    body.replaceChildren();
    for (const row of record.timeline) {
      const tr = this.doc.createElement("tr");
      const label = { kept: "kept", expired: "expired", open: "open" }[row.state];
      const date = this.doc.createElement("td");
      date.className = "mono";
      date.textContent = row.dateText;
      const act = this.doc.createElement("td");
      act.textContent = row.act;
      const state = this.doc.createElement("td");
      const pill = this.doc.createElement("span");
      pill.className = "pill " + row.state;
      pill.textContent = label;
      state.appendChild(pill);
      const link = this.doc.createElement("td");
      const a = this.doc.createElement("a");
      a.href = row.link;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = row.hash.slice(0, 12) + "…";
      link.appendChild(a);
      tr.append(date, act, state, link);
      body.appendChild(tr);
    }
    this.el("tl").hidden = record.timeline.length === 0;
    let text;
    if (!result.found) {
      text = result.note;
    } else if (record.transactionsRead === 0) {
      text = "No transactions: this key has done nothing on this network.";
    } else {
      text = `${record.transactionsRead} transactions read, ${record.timeline.length} commitment acts.`;
    }
    if (result.partial) {
      text += ` Partial: stopped after the first ${MAX_TRANSACTIONS} transactions.`;
    }
    this.setStatus(text, false);
  }

  /**
   * Set the status line under the counters.
   */
  setStatus(text, isError) {
    this.status = text;
    const status = this.el("st");
    status.className = isError ? "status err" : "status";
    status.textContent = text;
  }

  /**
   * What the page shows now, plus the facts the page states, as plain JSON.
   *
   * :return: The page state.
   */
  getState() {
    const networks = {};
    for (const [key, value] of Object.entries(NETWORKS)) {
      networks[key] = { label: value.label, node: value.node };
    }
    const shown = this.shown ? JSON.parse(JSON.stringify(this.shown)) : null;
    if (shown) {
      shown.timelineTotal = shown.timeline.length;
      shown.timeline = shown.timeline.slice(0, TIMELINE_FOR_AGENT);
    }
    return {
      page: "Three Numbers",
      today: today(),
      purpose: "For one XRPL key, what the ledger shows of its commitments: signed, kept, expired.",
      method: { ...METHOD },
      notSupported: [...NOT_SUPPORTED],
      networks: networks,
      exampleKey: { address: "rGJsjkfmASA2ezXYDpTQJZDp9tRgCJAPhw", network: "testnet" },
      sourceText: "https://zenodo.org/records/24176443",
      partners: [{ name: "Rule in force", what: "whether a French law article was in force on a date, with its XRPL anchor verified", link: "https://rule-in-force.onrender.com/" }],
      form: { address: this.el("k").value, network: this.el("net").value },
      status: this.status,
      shown: shown,
      version: this.version,
    };
  }
}

/**
 * Holds the one page object that the form, site.js and site-actions.js share.
 */
export class App {
  static page = new Page(globalThis.document, (url) => new NodeClient(url));

  /**
   * Wire the page's own form and example link to App.page.
   */
  static wire() {
    const page = App.page;
    page.el("f").addEventListener("submit", (event) => {
      event.preventDefault();
      void page.show(page.el("k").value, page.el("net").value);
    });
    page.el("ex").addEventListener("click", (event) => {
      event.preventDefault();
      void page.show(page.el("ex").dataset.k, "testnet");
    });
    const hash = decodeURIComponent(location.hash.slice(1));
    if (ADDRESS_PATTERN.test(hash)) {
      void page.show(hash, page.el("net").value);
    }
  }
}

// Wire the form only on the page itself: the action bridge frame loads this module too.
if (typeof window !== "undefined" && globalThis.document?.getElementById("f")) {
  App.wire();
}
