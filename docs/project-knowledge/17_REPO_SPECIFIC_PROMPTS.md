# 17_REPO_SPECIFIC_PROMPTS

Use these prompts with future coding agents working on MocapExpo. Each prompt tells the agent which docs to query first, to avoid loading all docs, to inspect repository truth, to make minimal changes, to list changed files, and to run relevant checks.

## 1. Safe Repo Inspection

```text
Use NotebookLM MCP to retrieve only `18_PROJECT_STATUS_CHECKPOINT.md`, `01_PROJECT_OVERVIEW.md`, and `04_PROJECT_STRUCTURE.md`.
Do not load all project docs.
Then inspect repository truth with `rg --files`, `package.json`, `backend/package.json`, `src/app/di/container.ts`, and `src/app/navigation/RootNavigator.tsx`.
Summarize the app, architecture, and exact files relevant to my task.
Do not modify source yet.
Mark anything not confirmed in repository.
```

## 2. Feature Implementation

```text
Use NotebookLM MCP to retrieve `05_FEATURE_MAP.md`, `03_ARCHITECTURE.md`, and the feature-specific doc for [feature].
Do not load all docs.
Inspect the relevant `src/features/`, `src/domain/`, `src/infra/`, and backend files named by the docs.
Propose a minimal implementation plan that follows existing DI, navigation, state, persistence, and backend boundaries.
After approval or if the task is clearly executable, make the smallest code changes, list changed files, and run relevant checks from `11_TESTING_AND_QA.md`.
Do not assume roadmap items are implemented.
```

## 3. Bug Fixing

```text
Use NotebookLM MCP to retrieve `14_KNOWN_RISKS_AND_TECH_DEBT.md`, `11_TESTING_AND_QA.md`, and the docs for [bug area].
Do not load all docs.
Inspect repository truth in the exact files responsible for the behavior.
Make the smallest fix that addresses the root cause without refactoring unrelated code.
List changed files, explain verification, and state any checks you could not run.
Do not modify package files or native build settings unless explicitly required and approved.
```

## 4. UI Polish

```text
Use NotebookLM MCP to retrieve `08_UI_UX_AND_DESIGN_SYSTEM.md` and `05_FEATURE_MAP.md`.
Do not load all docs.
Inspect the target screen and shared files in `src/ui/theme/` and `src/ui/components/`.
Use existing colors, typography, spacing, and component patterns.
Make minimal visual changes, list changed files, and run `npm run typecheck` if TypeScript changed.
Keep workflow screens compact and task-focused.
```

## 5. Architecture Refactor Planning

```text
Use NotebookLM MCP to retrieve `03_ARCHITECTURE.md`, `04_PROJECT_STRUCTURE.md`, and `14_KNOWN_RISKS_AND_TECH_DEBT.md`.
Do not load all docs.
Inspect current source files before proposing changes.
Create a refactor plan with scope, dependency direction, migration steps, tests, risks, and rollback notes.
Do not edit files until I approve the plan.
Clearly separate current implementation from roadmap assumptions.
```

## 6. Analytics Event Addition

```text
Use NotebookLM MCP to retrieve `09_ANALYTICS_OBSERVABILITY_AND_DEBUGGING.md` and `03_ARCHITECTURE.md`.
Do not load all docs.
Inspect navigation, service boundaries, and the target workflow.
If no analytics facade exists, propose or add a small central facade rather than direct SDK calls in screens.
Never include signed URLs, tokens, local file URIs, notes, device ids, or raw capture metadata in analytics.
Make minimal changes, list changed files, and run relevant type checks.
```

## 7. QA/Test Preparation

```text
Use NotebookLM MCP to retrieve `11_TESTING_AND_QA.md`, `21_QA_AND_ANIMATION_VALIDATION.md`, and the feature docs for [change].
Do not load all docs.
Inspect the changed files and their related source-truth files.
Create a focused verification checklist with automated commands and manual device QA steps.
Run available relevant checks only.
Report skipped checks and why.
```

## 8. Release Readiness Review

```text
Use NotebookLM MCP to retrieve `12_BUILD_RUN_AND_DEPLOYMENT.md`, `14_KNOWN_RISKS_AND_TECH_DEBT.md`, `11_TESTING_AND_QA.md`, and `18_PROJECT_STATUS_CHECKPOINT.md`.
Do not load all docs.
Inspect current build configs, env examples, signing references, and backend deployment docs.
Produce findings ordered by severity with file paths and concrete next steps.
Do not expose secrets or modify signing/build settings.
```

## 9. NotebookLM MCP Usage

```text
Use NotebookLM MCP with targeted retrieval only.
Start with `18_PROJECT_STATUS_CHECKPOINT.md` and then retrieve only the docs relevant to [task].
Do not ask NotebookLM to summarize the whole project.
After retrieval, verify all claims against repository files before editing.
When uncertain, write "Not confirmed in repository."
```

## 10. Documentation Update

```text
Update only files under `docs/project-knowledge/`.
Use NotebookLM MCP to retrieve the docs that mention [area], but do not load all docs.
Inspect current source files to verify the change.
Update documentation to reflect current implementation, not desired future behavior.
Do not modify source code, package files, lockfiles, env files, build settings, or secrets.
List created/updated docs and mention whether source code changed.
```

## 11. Risk Review

```text
Use NotebookLM MCP to retrieve `14_KNOWN_RISKS_AND_TECH_DEBT.md`, `03_ARCHITECTURE.md`, and the docs for [area].
Do not load all docs.
Inspect the current source files named by the docs.
Produce a risk review with severity, evidence/file path, why it matters, recommended next step, and whether to fix now or later.
Do not make code changes unless explicitly asked.
```

## 12. Monetization Feature Addition

```text
Use NotebookLM MCP to retrieve `10_MONETIZATION_AND_PRODUCT_GATING.md`, `15_ROADMAP_AND_NEXT_STEPS.md`, `07_BACKEND_AND_INTEGRATIONS.md`, and `03_ARCHITECTURE.md`.
Do not load all docs.
Inspect source to confirm monetization is not currently implemented.
Propose server-enforced entitlement design before mobile paywall UI.
Do not add payment SDKs, product IDs, StoreKit/Play Billing setup, or RevenueCat without explicit approval.
If approved, make minimal changes, list changed files, and run relevant checks.
```

## 13. State Management Changes

```text
Use NotebookLM MCP to retrieve `03_ARCHITECTURE.md`, `05_FEATURE_MAP.md`, and `06_DATA_MODELS_AND_STATE.md`.
Do not load all docs.
Inspect the relevant Zustand store, hooks, and consuming screens.
Preserve existing state ownership and avoid duplicating source of truth between stores and persistence.
Make minimal changes, list changed files, and run `npm run typecheck`.
Pay special attention to capture recording, upload status, and backend processing state.
```

## 14. Backend/API Integration Changes

```text
Use NotebookLM MCP to retrieve `07_BACKEND_AND_INTEGRATIONS.md`, `06_DATA_MODELS_AND_STATE.md`, `11_TESTING_AND_QA.md`, and `14_KNOWN_RISKS_AND_TECH_DEBT.md`.
Do not load all docs.
Inspect `backend/src/http/routes.ts`, relevant backend services/repositories, `src/infra/api/MocapApiClient.ts`, and the mobile service using the endpoint.
Keep DTOs and state transitions consistent across mobile and backend.
Make minimal changes, list changed files, and run backend typecheck/build plus root typecheck if mobile types changed.
Never expose env values, signed URLs, tokens, or storage credentials.
```
