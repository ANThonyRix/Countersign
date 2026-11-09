import type { CheckSpec, PackDefinition } from "../core/types.ts";
import * as c from "./checks.ts";

export const exchangePack: PackDefinition = {
  id: "exchange",
  mission: "Exchange: token listing desk",
  title: "Token listing review",
  tagline: "Should we list this token? Entity, contract, audience and press, each from a paid, verifiable miner answer.",
  labels: { GO: "LIST", REVIEW: "REVIEW", STOP: "REJECT" },
  fields: [
    { name: "project", label: "Project name", type: "text", required: true, placeholder: "Uniswap" },
    { name: "token", label: "Token contract", type: "address", required: true, placeholder: "0x…", help: "ERC-20 contract the desk is asked to list." },
    { name: "chain", label: "Chain", type: "text", placeholder: "Ethereum" },
    { name: "entity", label: "Issuing legal entity", type: "text", placeholder: "Universal Navigation Inc.", help: "Screened for sanctions. Defaults to the project name." },
    { name: "x", label: "Official X account", type: "text", placeholder: "@Uniswap" },
    { name: "treasury", label: "Treasury wallet", type: "address", placeholder: "0x…", help: "Balance is read at the latest mainnet block." },
    { name: "source", label: "Contract source excerpt", type: "textarea", placeholder: "Paste the token's Solidity source (optional)" },
  ],
  example: {
    project: "Uniswap",
    token: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    chain: "Ethereum",
    entity: "Universal Navigation Inc.",
    x: "@Uniswap",
    treasury: "0x1a9C8182C09F50C8318d769245beA52c32BE35BC",
    source: "",
  },
  subjectName: (s) => s.project,
  async plan(s, ctx) {
    const entity = s.entity || s.project;
    const checks: CheckSpec[] = [
      c.sanctionsCheck(entity, "issuer"),
      c.contractAuditCheck(s.token, s.chain || "Ethereum"),
      c.adverseMediaCheck(s.project, "hack OR exploit OR rug pull OR fraud OR SEC lawsuit"),
    ];
    if (s.x) checks.push(c.botCheck(s.x, s.project));
    if (s.treasury && ctx.latestBlock) {
      const block = await ctx.latestBlock().catch(() => undefined);
      if (block) checks.push(c.balanceCheck(s.treasury, block, "Treasury"));
    }
    if (s.source?.trim()) checks.push(c.codeReviewCheck(s.source));
    return checks;
  },
};
