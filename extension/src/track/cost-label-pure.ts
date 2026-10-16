// cost-label-pure.ts — how the status bar renders the local cost estimate.
//
// ⚠ WHY THIS IS ITS OWN MODULE. The number it produces sits directly beside an ISSUE IDENTIFIER in
// the status bar, and Track shows a number for that same issue. They are DIFFERENT QUANTITIES:
//   · this one is a LOCAL estimate of THIS EDITOR SESSION, priced at one flat rate — Claude 3
//     Haiku's, so it is 4x low on claude-haiku-4-5, the model this extension defaults to, and lower
//     still on everything else (the factors live once, in providers/cost-tracker.ts);
//   · Track's is the authoritative per-request cost for the WHOLE issue, recorded by Lens.
// A reader has every reason to take them for the same thing. The "~" and the wording below are the
// only things stopping an understated figure from reading as the bill, which is why they are pinned
// by a test rather than left to a code comment.

import type { IssueSpend } from "../lens/types";

/** The status-bar figure. The tilde is load-bearing: it marks the number as approximate. */
export function formatSessionCost(usd: number): string {
  return `~$${usd.toFixed(2)}`;
}

/**
 * The same estimate as a panel shows it, per task or per session. Same tilde; four places, because a
 * single generation costs fractions of a cent and "~$0.00" would say nothing.
 */
export function formatCostEstimate(usd: number): string {
  return `~$${usd.toFixed(4)}`;
}

/** The tooltip lines that say what the number is and is not. */
export function costDisclaimerLines(activeIssue?: string): string[] {
  const lines = ["Estimated locally at one flat rate — not your bill."];
  lines.push(
    activeIssue
      ? `Track shows the real cost for ${activeIssue}, recorded by Lens.`
      : "Track shows the real per-issue cost, recorded by Lens.",
  );
  return lines;
}

/**
 * The dashboard's issue spend, as Lens recorded it, with the window it covers. When Lens did not
 * answer it says so: a $0.00 here would read as "this issue cost nothing".
 */
export function issueSpendLabel(spend: IssueSpend): { figure: string; note: string } {
  if (!spend.issueId) return { figure: "—", note: "set an active issue to see its spend" };
  if (!spend.available) {
    return { figure: "not available", note: "Lens did not answer for this issue's spend" };
  }
  const usd = spend.totalCostUSD;
  return {
    figure: `$${usd > 0 && usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`,
    note: `${spend.requests} request${spend.requests === 1 ? "" : "s"} in the last ${spend.days} days, recorded by Lens`,
  };
}
