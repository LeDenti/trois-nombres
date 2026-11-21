// The read this site shares with other agent sites, through its action bridge.
// It runs in a hidden frame on this origin with no page: read_key reads a public XRPL
// node with the page's own counting code. Public ledger facts only, so shared with "*".
import { NodeClient, Page } from "../script.js";
import { registerActions as registerPageActions } from "../site-actions.js";

const page = new Page(null, (url) => new NodeClient(url));

export function registerActions(actions) {
  registerPageActions({
    register(definition) {
      if (definition.name !== "read_key") return;
      actions.register({
        ...definition,
        availability: "bridge",
        callerOrigins: ["*"],
        execute: async (args) => {
          const r = await page.lookUp(args.address, args.network || "testnet");
          if (r.ok && r.record) {
            r.record.timelineTotal = r.record.timeline.length;
            r.record.timeline = r.record.timeline.slice(0, 20);
          }
          return r;
        },
      });
    },
  });
}
