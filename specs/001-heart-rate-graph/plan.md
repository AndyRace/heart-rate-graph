# Implementation Plan: Interactive Heart Rate Graph

**Branch**: `001-heart-rate-graph` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-heart-rate-graph/spec.md`

## Summary

Build a static, local-only web application that streams one Google Fit heart-rate JSON export into
a dedicated browser worker, validates and stores up to 1,000,000 readings compactly, and exposes
bounded range queries to a responsive interactive chart and accessible data table. React owns only
UI state; the worker owns source readings, summaries, duplicate handling, range indexing, and
min/max-preserving display aggregation. No backend, account, database, or network transmission is
introduced.

## Technical Context

**Language/Version**: TypeScript 6 in strict mode; Node.js 22 LTS for local tooling

**Primary Dependencies**: React 19, Vite 8, uPlot 1.x, `@streamparser/json-whatwg` 0.x

**Storage**: In-memory worker-owned typed arrays for the active session; no durable or server storage

**Testing**: Vitest 5, React Testing Library, Playwright 1.x, `@axe-core/playwright` 4.x

**Target Platform**: Current and previous major Chrome, Edge, Firefox, Safari, and iOS Safari;
current Android Chrome; desktop and mobile viewports from 320 to 1920 pixels

**Project Type**: Static single-page web application with one dedicated module worker

**Performance Goals**: Import and show up to 1,000,000 records within 10 seconds on the named
representative test devices; provide visible feedback for 95% of range and detail interactions within
500 milliseconds; render at most four representative values per chart CSS pixel

**Constraints**: All health data remains in the browser session; input is streamed rather than loaded
as one string; exact source readings drive summaries; display aggregation preserves bucket first,
last, minimum, and maximum readings; line gaps exceed 30 minutes; WCAG 2.2 AA; no large fixture is
committed; unsupported browsers fail before import with a clear capability message

**Scale/Scope**: One active dataset, one supplied Google Fit schema, up to 1,000,000 accepted records,
one graph workspace, paginated non-visual readings, and no accounts, sharing, persistence, or direct
Google integration

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Pre-Research Gate

| Principle or constraint         | Evidence                                                                                                                                                                  | Status |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Maintainable code               | Domain, worker, UI, and adapter boundaries have focused ownership; no backend or global data store is added.                                                              | PASS   |
| Tests define behavior           | Unit, worker integration, component, browser, accessibility, and performance checks map to acceptance criteria.                                                           | PASS   |
| Health data remains trustworthy | Exact readings stay separate from display aggregates; validation categories, nanosecond conversion, duplicates, timezone behavior, and line gaps have explicit contracts. | PASS   |
| Consistent UX                   | One canonical range state drives brush, touch, fields, summaries, table, and reset behavior.                                                                              | PASS   |
| Ease of use and accessibility   | Native controls, keyboard parity, live status, semantic summaries, and a paginated data table supplement the canvas.                                                      | PASS   |
| Product constraints             | Input schema, bpm units, timezone conversion, malformed records, 1,000,000-record scale, performance budgets, and medical disclaimer are specified.                       | PASS   |
| Quality gates                   | Formatting, static checks, build, automated tests, responsive checks, and state coverage are required by the quickstart.                                                  | PASS   |

No constitution violations require an exception.

### Post-Design Gate

Phase 1 preserves every pre-research gate. The input contract makes source-field extraction explicit;
the worker protocol prevents the full health dataset from entering React; the data model separates
source facts from derived display values; and the quickstart provides executable evidence for data
integrity, accessibility, responsive behavior, and performance. Status: **PASS**.

## Phase 0: Research Decisions

Research decisions and rejected alternatives are recorded in [research.md](research.md). The
research resolves framework, charting, streaming, memory representation, state ownership,
accessibility, browser support, and test strategy. No open research questions remain.

The original large JSON fixture is not present in the current working tree. The parser contract uses
the known Google Fit derived heart-rate shape and requires a contract test against a restored private
copy of the supplied export before implementation is considered complete. The fixture remains local
and ignored; generated small fixtures cover repeatable automated tests.

## Phase 1: Design and Contracts

- [data-model.md](data-model.md) defines import, reading, range, summary, validation, and display
  entities with state transitions and invariants.
- [contracts/google-fit-heart-rate-json.md](contracts/google-fit-heart-rate-json.md) defines the one
  supported source grammar, field mappings, precision rules, and rejection categories.
- [contracts/worker-protocol.md](contracts/worker-protocol.md) defines commands, events, transfer
  boundaries, cancellation, replacement staging, and stale-response handling.
- [contracts/ui-behavior.md](contracts/ui-behavior.md) defines synchronized range controls, chart
  semantics, accessibility, responsive states, and user-visible errors.
- [quickstart.md](quickstart.md) defines setup and end-to-end validation scenarios.

## Project Structure

### Documentation (this feature)

```text
specs/001-heart-rate-graph/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── google-fit-heart-rate-json.md
│   ├── ui-behavior.md
│   └── worker-protocol.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── App.tsx
│   ├── app-context.tsx
│   └── app-reducer.ts
├── domain/
│   ├── aggregation.ts
│   ├── readings.ts
│   ├── summary.ts
│   ├── time-range.ts
│   └── validation.ts
├── features/
│   ├── accessible-data/
│   ├── chart/
│   ├── import/
│   └── range/
├── shared/
│   ├── format.ts
│   └── worker-messages.ts
├── worker/
│   ├── compact-store.ts
│   ├── import-worker.ts
│   ├── parser-adapter.ts
│   ├── queries.ts
│   └── worker-client.ts
├── main.tsx
└── styles.css

tests/
├── components/
├── e2e/
├── fixtures/
├── integration/
├── performance/
└── unit/
```

**Structure Decision**: Use one frontend project. Feature folders own user-facing workflows, pure
domain modules own testable health-data rules, and the worker boundary owns the large dataset. A
backend would violate the local-only constraint and provide no feature value.

## Complexity Tracking

No constitution violations or exceptional complexity are accepted. The worker and streaming parser
are necessary to meet responsiveness and memory constraints for million-record files; their narrow
contracts keep that complexity isolated.
