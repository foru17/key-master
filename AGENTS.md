# AGENTS.md — key-master

- Implement exactly what SPEC.md says; SPEC.md is the contract. If something is ambiguous, pick the simplest option and note it in README "Design notes".
- Open-source repo: never write real domains, IP addresses, bot names, tokens or subscription content. Use example.com, 203.0.113.0/24, YOUR_BOT_TOKEN.
- TypeScript strict, pnpm workspace, Node 22+. All identifiers and code comments in English. User-facing texts zh + en.
- Every behavior in SPEC "Decision", "Client detection" and "Denied responses" must have table-driven Vitest tests.
- Do not add paid/cloud dependencies. No telemetry.
