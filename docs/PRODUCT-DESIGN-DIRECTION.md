# PRAXIS public product design direction

2026-10-03. Approved after the user explicitly included the dashboard redesign.
This document does not change existing features or backend/evidence contracts.

## The product people should understand

Bring the project you built with AI. Explain what it should do. PRAXIS studies
the source, runs the checks you allow, and makes the next engineering decision
clear. The useful outcome is a specific problem with its evidence and a plan
you can review and hand to your coding agent.

The distinctive visual idea is an inspection workspace: a project, its intended
behavior, the observations, and the next decision remain visibly connected.
The axolotl is a calm guide. Its personality can make the product approachable
without turning incomplete checks into celebrations.

## What needs coherence

The public website uses warm cream and orange, the review dashboard uses slate
and peach, and the film previously introduced another blue editorial frame.
They should feel like one product. The existing app also has two broad style
layers, `globals.css` and `product.css`; a future implementation should consolidate
tokens and component rules before adding another pile of overrides.

The dashboard exposes a useful amount of evidence, but too many blocks compete
for equal attention. Keep a strong primary decision, a short explanation, the
most relevant observed evidence, and one next action. Detailed records remain
inspectable through deliberate disclosure. Do not hide unavailable providers,
skipped execution, coverage gaps or unsupported conclusions to make it cleaner.

## Three creative directions

1. A conversational guide: approachable and helpful, but a chat-only interface
   makes the project structure and execution limits harder to inspect.
2. A visual command center: impressive, but a persistent graph and animated
   dashboards add density before they help someone make a decision.
3. An inspection workspace: a focused project brief, readable findings and a
   clear path from observation to plan. Recommended for the public tool.

## Proposed experience

### Bring a project

One source input with explicit GitHub, upload and local routes. A compact goal
field, provider/budget summary and explicit runtime consent keep the next action
clear. Explain browser source inspection and deeper local checks at the point
where the choice matters. Do not suggest the hosted website executes arbitrary
untrusted projects when it does not.

### Understand the review

Use the actual backend stages to show progress. Keep the project brief and
human/agent conversation in a context drawer. The provider cards should align
and show actual inspection state, spending limits and relevant observations.
The current bounded team and privacy controls remain in place. A glowing agent
icon must never imply a completed model call or runtime observation.

### Decide what to fix

Lead with plain language: what could fail for a user, what was observed, and
what remains unknown. Expand one finding into its source or test evidence.
Source paths and raw logs belong in separate, readable technical sections.
Show successful checks alongside missing checks, with their scope intact.

### Hand off a plan

Keep the existing planning contract: inspect changes, risks and tests before
implementation. Offer the connected provider and copy-to-current-agent routes.
Distinguish a copied prompt, a generated plan, a completed implementation and
verified execution. Preserve source-apply approval and shared budget checks.

## Visual system and motion

- Charcoal/slate surfaces, warm off-white text and a restrained peach brand
  accent connect the mascot to the product. Blue identifies inspection actions.
  Emerald, amber and red communicate actual evidence states consistently.
- Use one spacing scale, one type hierarchy and a small set of shared panel,
  disclosure, status and evidence components. Keep long cards bounded through
  progressive disclosure, not arbitrary truncation of important conclusions.
- Animate relationships and state changes: a source becomes an active review,
  a finding opens its evidence, a reviewed plan moves into a handoff. Keep
  reading surfaces still. Respect reduced motion throughout.
- The mascot can respond to real milestones with the owned animations. It is
  a guide, not evidence, and it should not sit over controls or test output.
- Keep desktop and mobile layouts equally deliberate. Test long paths, many
  findings, missing providers, empty results and narrow screens as real states.

## Implementation sequence

1. Record and pressure-test the existing browser/local/plan journeys.
2. Consolidate design tokens and shared components without changing contracts.
3. Rework one complete review journey, with real backend states and no mock data.
4. Apply the same identity to the landing page, local tool and tray assets.
5. Validate accessibility, overflow, TypeScript, production build and backend
   regressions. Recheck the CLI package budget before adding public assets.

The dashboard implementation is part of this pass. It shares the existing API
contracts and presents real saved results. The revised local screens are
recaptured for the film after the app regressions and accessibility checks pass.

## Implementation and validation

The intake puts the project goal beside the source. The review begins with the
engineering decision and its next actions; evidence gates, retained gaps,
specialist opinions and project context remain inspectable below. Specialists
use a balanced two-column layout. All seven review sections, both appearances,
budget/trust controls and the separate planning, handoff and apply gates remain.

`tokens.css` owns semantic colors; `globals.css` owns shared controls and dialogs;
`product.css` owns the component layouts and responsive behavior. The separate
`ReviewOverview` and `InspectionIllustration` components keep presentation out of
the transport and verification logic. Reading panels remain still; selecting a
section has a short entrance transition, disabled under reduced motion.

The production build and TypeScript pass. The unchanged backend suite reports
179 passing tests and three environment skips. Frontend pressure checks cover 14
states in both appearances at 320, 390, 768, 1024 and 1440 pixels, with zero axe
violations, no escaped card text and eight preserved action contracts. These are
automated checks and sampled visual inspection, not a claim of exhaustive
accessibility certification or production readiness of submitted projects.
