// Registers the Three Numbers page's operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names in
// "actions.agentTools" become model tools, called website_<name>.
// Every rule lives in script.js; this file only wraps App.page.
import { App, TIMELINE_FOR_AGENT } from "./script.js";

/**
 * The arguments that name one key on one network, shared by both key actions.
 */
const KEY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["address"],
  properties: {
    address: {
      type: "string",
      minLength: 20,
      maxLength: 40,
      description: "The XRPL classic address (starts with r) the visitor gave, exactly as written.",
    },
    network: {
      type: "string",
      enum: ["testnet", "mainnet"],
      default: "testnet",
      description: "testnet unless the visitor says mainnet or the address is a mainnet one they named.",
    },
  },
};

/**
 * Describes the page's operations as actions the agents can call.
 */
class SiteActions {
  /**
   * Register every site action with the runtime.
   *
   * :param actions: The runtime registry facade with a register(definition) method.
   */
  static registerActions(actions) {
    actions.register(SiteActions.getPageAction());
    actions.register(SiteActions.readKeyAction());
    actions.register(SiteActions.showKeyAction());
  }

  static getPageAction() {
    return {
      name: "get_page",
      description: "Read this page: how it counts (method), what it cannot do, the networks, an example key, and the key record the page shows now (null if none). Changes nothing.",
      effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: SiteActions.getPage,
    };
  }

  static getPage() {
    return App.page.getState();
  }

  static readKeyAction() {
    return {
      name: "read_key",
      description: `Read one key's commitment record from a public XRPL node: signed, kept, expired, open on the ledger, defenders, acts for others, and the ${TIMELINE_FOR_AGENT} newest acts with explorer links and ready-made short hashes (hashShort). Does not change the page. Returns ok false with a reason for a bad address or a node error; found false when the key does not exist on that network; partial true when only the first transactions were read.`,
      effect: "read",
      inputSchema: KEY_SCHEMA,
      timeoutMs: 90000,
      execute: SiteActions.readKey,
    };
  }

  static async readKey(args) {
    return SiteActions.trim(await App.page.lookUp(args.address, args.network || "testnet"));
  }

  static showKeyAction() {
    return {
      name: "show_key",
      description: "Show one key's record in the page's own counters and timeline, replacing what the page shows, exactly as the page's Read button does. Returns the same record as read_key.",
      effect: "write",
      inputSchema: KEY_SCHEMA,
      timeoutMs: 90000,
      execute: SiteActions.showKey,
    };
  }

  static async showKey(args) {
    return SiteActions.trim(await App.page.show(args.address, args.network || "testnet"));
  }

  /**
   * Keep only the newest timeline rows, so the result stays small for the model.
   *
   * :param result: A look-up result.
   * :return: The same result with timeline cut to TIMELINE_FOR_AGENT and timelineTotal added.
   */
  static trim(result) {
    if (!result.ok || !result.record) {
      return result;
    }
    const record = { ...result.record };
    record.timelineTotal = record.timeline.length;
    record.timeline = record.timeline.slice(0, TIMELINE_FOR_AGENT);
    return { ...result, record: record };
  }
}

// The runtime calls the module's registerActions export.
export const registerActions = SiteActions.registerActions;
