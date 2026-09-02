# AGENTS.md

This project keeps a single source of truth for agent guidance in **CLAUDE.md**. Read it first.

## Product positioning

- **Core feature = AI 工作站 (AI Workstation)** — the `home` nav item (`nav.aiWorkstation`), rendered by `src/components/AiChatPanel.jsx` (App.jsx:2305). It is a deep agent workbench: multiple professional agents + tool orchestration + plan execution (`set_plan`) — NOT a simple chat panel.
- **AI Elf (`src/AiElf.jsx`) = 全站轻量智能助手** — singleton agent ("方案 A 去 agent 化", config in `src/constants/aielfDefaults.js`). Low-friction: quick Q&A anywhere, drag news/stock/code/GitHub cards in for instant analysis, helps users understand the product and operations. Analysis output can be handed off to the Workstation (存入工作站). Tool whitelist is analysis/verification only — no multi-step orchestration.
- **Multi-agent orchestration is real (Phase 8)**: shared loop core `src/components/aichat/agentLoopCore.js` (both Workstation & Elf); `spawn_subagent` (orchestrator-worker, presets in `src/domain/agent/subagentCore.js`, runner in `src/components/aichat/subagentRunner.js`) and `spawn_agent_team` (shared task list + mailbox via `src/store/teamStore.js`, core in `src/domain/agent/teamCore.js`). Subagents run with fresh context, shrunk tool whitelists (no spawn tool → depth hard-capped at 1), per-task budgets; all tool results are wrapped in `<untrusted_data>` before reaching the LLM.
- Division of labor: AiElf = low-friction instant judgment; Workstation (AiChat) = deep multi-step work.

## Quick reference

- **Run**: npm install && npm run dev (dev server on 0.0.0.0:5175 with API middleware)
- **Build**: npm run build -> dist/
- **Test**: npm test (vitest, 626 unit tests across 63 files; all pass as of 2026-09)
- **Test single file**: node node_modules/vitest/vitest.mjs run <file>
- **Integration / E2E**: npm run test:integration / npm run test:e2e (Playwright)
- **Platform check**: npm run verify:platform (DB + services connectivity)
- **Production server**: npm run start (Node serves dist/ + full API, default port 3000)
- **DB migrate**: npm run db:migrate (requires DATABASE_URL; creates PostgreSQL tables)
- **Scrapling**: python scrapling_server.py (Flask on port 5000, optional)
- **Preheat today**: npm run preheat:today [userId] (manually trigger today's recommendation snapshot preheat)
- **Dev port**: 5175 (not 5173). `vite preview` serves static only — no API middleware
- **No lint/typecheck/formatter commands exist**
- **ESM only**: package.json type:module - all .js use ESM, never require()
- **Windows vitest gotcha**: `npx vitest` fails (bin symlink not created) — use `node node_modules/vitest/vitest.mjs run`; pin vitest to 3.x (4.x has rolldown binding failures)

## Where things live

- Frontend: src/App.jsx (monolithic, ~3000 lines) + src/components/ + src/domain/ (pure-logic engines) + src/hooks/ + src/store/ (Zustand) + src/shell/ + src/blocks/
- News backend: server/news/ (Vite middleware plugin; `server/newsPlugin.js` is a re-export shim)
- Platform backend: server/auth, server/community, server/profile, server/db, server/http (shared handlers), plus server/agent, server/cron, server/creative, server/intelligence, server/mcp, server/security, server/skills
- Production serverless: api/*.js (delegate to the same server/http/*Handlers.js as dev — update shared handlers, not both sides)

Architecture boundaries: src/domain/ engines are pure logic (no React, no HTTP) and unit-tested in place; server/http/ handlers are shared by dev plugin and Vercel serverless; Postgres auth/profile/community require DATABASE_URL (endpoints return 503 DATABASE_UNAVAILABLE without it).

For full architecture, endpoints, gotchas, and known issues, see **CLAUDE.md**.

