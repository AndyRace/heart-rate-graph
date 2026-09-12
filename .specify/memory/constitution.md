<!--
Sync Impact Report
- Version change: template (unratified) -> 1.0.0
- Modified principles:
	- Principle 1 template slot -> I. Maintainable Code by Default
	- Principle 2 template slot -> II. Tests Define Expected Behavior
	- Principle 3 template slot -> III. Health Data Must Remain Trustworthy
	- Principle 4 template slot -> IV. One Consistent User Experience
	- Principle 5 template slot -> V. Ease of Use and Accessibility
- Added sections:
	- Product and Technical Constraints
	- Development Workflow and Quality Gates
- Removed sections: None
- Follow-up TODOs: None
-->
# Heart Rate Graph Constitution

## Core Principles

### I. Maintainable Code by Default
Production code MUST be clear, cohesive, and no more complex than the current requirement demands.
Names MUST communicate intent, modules MUST have focused responsibilities, and duplication MUST be
removed when it represents the same business rule. Public behavior and non-obvious design decisions
MUST be documented. Static analysis, formatting, and compilation checks configured by the project
MUST pass before a change is merged. Complexity is acceptable only when the change documents why a
simpler design cannot meet the requirement. These rules keep future changes understandable and
reduce defects caused by hidden coupling.

### II. Tests Define Expected Behavior
Every behavior change MUST include automated tests that fail without the change and pass with it.
Tests MUST cover the smallest appropriate boundary: unit tests for calculations and transformations,
integration tests for component or data-flow contracts, and end-to-end tests for critical user
journeys. Defect fixes MUST include a regression test. Tests MUST be deterministic, isolated from
uncontrolled time or network dependencies, and named in terms of observable behavior. A change MAY
omit automation only when the pull request records why automation is impractical and provides a
repeatable manual verification procedure. Tests provide executable evidence that requirements are
met and remain met.

### III. Health Data Must Remain Trustworthy
Heart-rate values, timestamps, units, ordering, and source metadata MUST retain their meaning through
ingestion, transformation, visualization, and export. Code MUST reject or explicitly represent
invalid, missing, duplicate, and out-of-range data rather than silently inventing values. Any
aggregation, interpolation, filtering, or timezone conversion MUST be visible in requirements and
covered by representative boundary tests. Private health data MUST remain local unless a requirement
explicitly authorizes transmission and identifies the destination and user consent flow. Trustworthy
data is essential because a polished graph is harmful when it misrepresents the underlying record.

### IV. One Consistent User Experience
Shared visual tokens, components, terminology, interaction patterns, and formatting rules MUST be
reused across the product. The same action or data state MUST have the same label, appearance, and
behavior in every view unless a documented contextual need requires a difference. Loading, empty,
error, partial-data, and success states MUST be designed alongside the primary state. Responsive
layouts MUST preserve hierarchy and task completion across supported viewport sizes. Reviews MUST
compare new UI against established patterns so the product remains predictable rather than becoming
a collection of locally reasonable but incompatible decisions.

### V. Ease of Use and Accessibility
Primary tasks MUST be discoverable without instructions embedded in the interface and MUST require
only actions necessary to complete the user's goal. Controls MUST use familiar semantics, provide
immediate feedback, preserve user work during recoverable failures, and offer a clear recovery path.
All interactive functionality MUST be keyboard operable, expose meaningful accessible names, retain
visible focus, and meet WCAG 2.2 AA contrast requirements. Charts MUST provide a non-visual way to
access their essential values and trends. Usability and accessibility are acceptance criteria, not
post-release enhancements, because every avoidable obstacle prevents users from understanding their
own data.

## Product and Technical Constraints

- Requirements MUST define supported input formats, units, timezone behavior, expected data volume,
	and malformed-data handling before implementation begins.
- The application MUST distinguish informational visualization from medical advice and MUST avoid
	diagnostic claims unless separately reviewed and approved for that purpose.
- Dependencies MUST have a current maintenance history, a compatible license, and a concrete benefit
	that outweighs their security, size, and maintenance cost.
- Performance budgets MUST be stated for changes that can affect import time, rendering latency, or
	interaction responsiveness; representative data sets MUST be used for validation.
- User-facing text and visualizations MUST remain legible at supported viewport sizes and browser zoom
	levels without content overlap or loss of essential functionality.

## Development Workflow and Quality Gates

1. Each change MUST start with testable acceptance criteria that identify affected data states and
	 user journeys.
2. Implementation MUST be kept to the smallest coherent change that satisfies those criteria and the
	 Core Principles.
3. Before review, contributors MUST run the repository's formatter, static checks, build, and relevant
	 automated tests. User-interface changes MUST also be checked at representative desktop and mobile
	 sizes, with keyboard navigation and all applicable loading, empty, error, and success states.
4. Reviewers MUST verify requirement coverage, data integrity, test evidence, UX consistency,
	 accessibility, and justified complexity. A failed mandatory gate blocks merge.
5. Exceptions MUST identify the violated rule, rationale, risk, compensating control, owner, and an
	 expiry date or follow-up issue. Undocumented or open-ended exceptions are not permitted.

## Governance

This constitution governs all specifications, plans, tasks, implementation, and reviews in this
repository. When another project document conflicts with it, this constitution takes precedence.

Amendments MUST be proposed as a documented change to this file, include a Sync Impact Report, state
the motivation and migration impact, and receive explicit maintainer approval. Amendments take effect
when merged. Materially affected work MUST include a migration plan or a recorded, time-bounded
exception.

Versions follow semantic versioning: MAJOR for incompatible governance changes or removed/redefined
principles, MINOR for new principles or materially expanded obligations, and PATCH for clarifications
that do not alter obligations. The Last Amended date MUST match the date of the latest substantive
change.

Every specification and pull request review MUST include an explicit constitution compliance check.
Maintainers MUST review this constitution at least annually and after any recurring quality, data, or
usability failure. Compliance evidence MUST be concrete, such as test results, review notes,
accessibility checks, or approved exception records.

**Version**: 1.0.0 | **Ratified**: 2026-09-12 | **Last Amended**: 2026-09-12
