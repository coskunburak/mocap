# 16_NOTEBOOKLM_UPLOAD_GUIDE

## Goal

Upload these docs to NotebookLM so future coding agents can retrieve precise project knowledge without loading the entire repository.

NotebookLM should be used for targeted retrieval. The repository remains the source of truth before editing code.

## Which Files To Upload First

Upload this core set first:

1. `18_PROJECT_STATUS_CHECKPOINT.md`
2. `01_PROJECT_OVERVIEW.md`
3. `03_ARCHITECTURE.md`
4. `04_PROJECT_STRUCTURE.md`
5. `05_FEATURE_MAP.md`
6. `06_DATA_MODELS_AND_STATE.md`
7. `07_BACKEND_AND_INTEGRATIONS.md`
8. `14_KNOWN_RISKS_AND_TECH_DEBT.md`
9. `13_AI_AGENT_GUIDE.md`

Then upload:

- `08_UI_UX_AND_DESIGN_SYSTEM.md`
- `09_ANALYTICS_OBSERVABILITY_AND_DEBUGGING.md`
- `10_MONETIZATION_AND_PRODUCT_GATING.md`
- `11_TESTING_AND_QA.md`
- `12_BUILD_RUN_AND_DEPLOYMENT.md`
- `15_ROADMAP_AND_NEXT_STEPS.md`
- `17_REPO_SPECIFIC_PROMPTS.md`
- `19_POSE_PIPELINE.md`
- `20_MODEL_INFERENCE_AND_EXPORT.md`
- `21_QA_AND_ANIMATION_VALIDATION.md`

## Which Files Are Source Of Truth Docs

These describe current implementation as inspected from repository source:

- `01_PROJECT_OVERVIEW.md`
- `02_TECH_STACK.md`
- `03_ARCHITECTURE.md`
- `04_PROJECT_STRUCTURE.md`
- `05_FEATURE_MAP.md`
- `06_DATA_MODELS_AND_STATE.md`
- `07_BACKEND_AND_INTEGRATIONS.md`
- `08_UI_UX_AND_DESIGN_SYSTEM.md`
- `09_ANALYTICS_OBSERVABILITY_AND_DEBUGGING.md`
- `10_MONETIZATION_AND_PRODUCT_GATING.md`
- `11_TESTING_AND_QA.md`
- `12_BUILD_RUN_AND_DEPLOYMENT.md`
- `14_KNOWN_RISKS_AND_TECH_DEBT.md`
- `18_PROJECT_STATUS_CHECKPOINT.md`
- `19_POSE_PIPELINE.md`
- `20_MODEL_INFERENCE_AND_EXPORT.md`
- `21_QA_AND_ANIMATION_VALIDATION.md`

Still verify against source before editing.

## Which Files Are Roadmap Or Agent Workflow Docs

These are planning or workflow aids:

- `13_AI_AGENT_GUIDE.md`
- `15_ROADMAP_AND_NEXT_STEPS.md`
- `16_NOTEBOOKLM_UPLOAD_GUIDE.md`
- `17_REPO_SPECIFIC_PROMPTS.md`

Roadmap docs must not be treated as proof that a feature exists.

## How To Query NotebookLM Through MCP

Use questions that name the feature and the task.

Good:

- "Retrieve the docs that explain signed URL upload and backend processing state transitions."
- "Which files define capture metadata, and what risks exist around dual/Pro capture?"
- "What is the safe way to add analytics to this app?"

Avoid:

- "Summarize everything."
- "Load all docs."
- "Tell me all files in the app."

## Targeted Questions Future Agents Should Ask

| Task | NotebookLM query |
| --- | --- |
| Understand architecture | "Retrieve `03_ARCHITECTURE.md` and summarize dependency direction, DI, data flow, and files to inspect before changing capture/upload." |
| Add a feature | "Retrieve `05_FEATURE_MAP.md`, `03_ARCHITECTURE.md`, and the feature-specific doc for [feature]. What files own this behavior and what boundaries should not be bypassed?" |
| Fix a bug | "Retrieve `14_KNOWN_RISKS_AND_TECH_DEBT.md` and any docs for [feature]. What are the known risks and exact files to inspect?" |
| Update UI | "Retrieve `08_UI_UX_AND_DESIGN_SYSTEM.md` and the feature map for [screen]. What tokens/components/styles are already used?" |
| Add analytics | "Retrieve `09_ANALYTICS_OBSERVABILITY_AND_DEBUGGING.md`. What redaction rules and facade strategy should be followed?" |
| Work on monetization | "Retrieve `10_MONETIZATION_AND_PRODUCT_GATING.md` and `15_ROADMAP_AND_NEXT_STEPS.md`. What is implemented vs not confirmed?" |
| Prepare QA | "Retrieve `11_TESTING_AND_QA.md` and `21_QA_AND_ANIMATION_VALIDATION.md`. What checks match this change?" |
| Plan refactor | "Retrieve `03_ARCHITECTURE.md`, `04_PROJECT_STRUCTURE.md`, and `14_KNOWN_RISKS_AND_TECH_DEBT.md`. What dependencies and risks constrain this refactor?" |

## Prompt Examples

### Understanding Architecture

```text
Use NotebookLM MCP to retrieve only `03_ARCHITECTURE.md`, `04_PROJECT_STRUCTURE.md`, and `18_PROJECT_STATUS_CHECKPOINT.md`.
Summarize the current architecture of MocapExpo and list the exact files I should inspect before changing [area].
Do not load all docs. Mark anything not confirmed in repository.
```

### Adding A Feature

```text
Use NotebookLM MCP to retrieve `05_FEATURE_MAP.md`, `03_ARCHITECTURE.md`, and the most relevant domain doc for [feature].
Then inspect the source files named by those docs.
Propose a minimal implementation plan that follows the existing DI, navigation, persistence, and backend boundaries.
Do not assume roadmap items are implemented.
```

### Fixing A Bug

```text
Use NotebookLM MCP to retrieve `14_KNOWN_RISKS_AND_TECH_DEBT.md` plus the docs for [feature].
Find the exact source files responsible for the bug.
Make the smallest safe fix, list changed files, run relevant checks from `11_TESTING_AND_QA.md`, and state residual risk.
```

### Updating UI

```text
Use NotebookLM MCP to retrieve `08_UI_UX_AND_DESIGN_SYSTEM.md` and `05_FEATURE_MAP.md`.
Inspect the target screen and shared theme/components.
Make a minimal UI update using existing colors, typography, spacing, and screen patterns.
Do not turn workflow screens into landing pages.
```

### Adding Analytics

```text
Use NotebookLM MCP to retrieve `09_ANALYTICS_OBSERVABILITY_AND_DEBUGGING.md`.
Inspect navigation and service boundaries.
Add analytics through a central facade with typed events and PII redaction.
Do not log signed URLs, tokens, local file paths, notes, or raw capture metadata.
```

### Working On Monetization

```text
Use NotebookLM MCP to retrieve `10_MONETIZATION_AND_PRODUCT_GATING.md`, `15_ROADMAP_AND_NEXT_STEPS.md`, and `07_BACKEND_AND_INTEGRATIONS.md`.
Identify what monetization is not currently implemented.
Propose server-enforced entitlements before any mobile paywall changes.
Do not add payment SDKs or product IDs without explicit approval.
```

### Preparing QA

```text
Use NotebookLM MCP to retrieve `11_TESTING_AND_QA.md` and `21_QA_AND_ANIMATION_VALIDATION.md`.
Create a feature-specific verification checklist for [change].
Run only relevant available checks and report anything that cannot be verified.
```

### Planning Refactor

```text
Use NotebookLM MCP to retrieve `03_ARCHITECTURE.md`, `04_PROJECT_STRUCTURE.md`, and `14_KNOWN_RISKS_AND_TECH_DEBT.md`.
Inspect the current source files.
Produce a refactor plan with risks, migration strategy, tests, and rollback notes.
Do not modify files until the user approves the plan.
```

## Warnings

- Do not summarize all docs every time.
- Use targeted retrieval.
- Verify with repository source before editing.
- Do not expose secrets from `.env` or deployment files.
- Do not treat roadmap files as implementation.
- Do not use NotebookLM output to overwrite source without checking current files.
