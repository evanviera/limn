# Limn Monetization Strategy

> Product recommendation for later review. Pricing and packaging are proposals,
> not committed product policy.

## Recommendation

Use a hybrid model:

1. Keep Limn's local-first core genuinely free.
2. Charge teams for advanced coordination and convenience.
3. Introduce an optional paid synchronization service only when Limn can operate
   it reliably and securely.

The commercial promise should be:

> Users pay for professional coordination features and services Limn operates,
> not for permission to access their own files.

This reinforces Limn's differentiation—ownership, privacy, simplicity, and
independence—instead of positioning it as a smaller version of Trello or Asana.

## Proposed Packaging

### Limn Free

Free forever, with no account required:

- Unlimited local boards and cards
- Readable workspace files
- Notes, checklists, labels, and due dates
- Attachments
- One active identity
- Basic Filter and My Tasks functionality
- Import and export
- Conflict detection and recovery

The free product should remain useful for individuals and credible enough for a
small team to evaluate Limn with real work.

### Limn Team

Proposed price: **$99 per workspace per year**, including up to five people.
Additional members could cost approximately **$15–20 per year** each. Offer a
monthly option around **$12 per workspace per month**.

Candidate Team features:

- Multiple members and assignments
- Comments and mentions
- Saved and shared views
- Slack integration
- Activity and mention inbox
- Board templates
- Recurring tasks and automation
- Calendar subscriptions
- Advanced filtering and reporting
- Workspace roles and permissions
- Priority support
- Extended conflict and version history

Flat workspace pricing is preferable to conventional per-seat SaaS pricing for
Limn's target customer. Small trusted teams frequently include contractors,
clients, and occasional collaborators. Pricing every participant as a full seat
would add friction and work against the product's simple, cooperative character.

### Limn Business

Proposed starting price: **$249 per workspace per year**, covering approximately
15–25 people.

Candidate Business features:

- Everything in Limn Team
- Audit history
- Administrative controls
- Workspace policies
- Central license management
- Assisted onboarding
- Invoice billing
- Higher-priority support
- Backup and recovery tools
- Help configuring supported Git or cloud-folder workflows

Do not invest heavily in enterprise SSO, compliance programs, procurement
workflows, or complex organization hierarchies until customers explicitly request
and are willing to prepay for them.

## Optional Paid Service: Limn Sync

The strongest long-term recurring-revenue opportunity is an optional managed
synchronization service offering:

- End-to-end encrypted synchronization
- Simple team sharing without Dropbox, iCloud, or OneDrive configuration
- Version history
- Reliable background synchronization
- Managed backups
- Eventual web or mobile access

A reasonable initial target would be **$5 per person per month** or approximately
**$15–20 per month for a small workspace**.

This service should remain optional. Customers must always be able to use their
own folders and synchronization providers without losing access to the core app.

## Pricing Context

Current adjacent-product pricing provides useful boundaries:

- Obsidian keeps its local application free and charges roughly $4–5 per user per
  month for optional encrypted Sync.
- Trello Standard is roughly $5 per user per month and Premium roughly $10 per
  user per month.
- Linear's entry paid plan is roughly $10 per user per month.
- Basecamp offers per-user pricing for smaller organizations and a fixed-price,
  unlimited-user package for larger organizations.

Limn should not initially match the per-seat prices of mature hosted products.
Those products bundle infrastructure, mobile access, integrations, administration,
and years of operational maturity. Limn should instead make its local-first
economics and simpler workspace pricing part of the value proposition.

Pricing pages reviewed when this recommendation was written:

- [Obsidian pricing](https://obsidian.md/pricing.html)
- [Trello pricing](https://trello.com/en/pricing)
- [Linear pricing](https://linear.app/pricing)
- [Basecamp pricing](https://basecamp.com/pricing)

Prices should be verified again before any commercial launch.

## Monetization Guardrails

The following capabilities should not be placed behind a paywall:

- Opening or editing existing workspaces
- Export and readable-file access
- Conflict recovery
- User-managed backups
- Security updates
- Core accessibility
- Basic search
- Removing data from Limn

If a paid workspace lapses, users should retain normal access to their content.
Paid coordination features may become unavailable, but the workspace should not
become read-only. Limn must never create the impression that it can ransom or
strand user-owned project files.

Avoid monetization based on advertising, selling behavioral data, invasive
telemetry, or artificial local storage limits. Each would weaken the trust behind
the local-first positioning.

## Suggested Launch Sequence

1. Keep all features free throughout the current beta.
2. Offer an optional **Founding Supporter** license for approximately $49–79,
   including two years of future Team features.
3. Interview 15–20 active users about team size, sharing method, purchasing
   authority, and the feature they would pay to keep.
4. Launch Limn Team at $99 per year with a 30-day trial and no credit card.
5. Grandfather early users generously and communicate changes well in advance.
6. Measure workspace retention and actual collaboration activity before investing
   in managed Sync.
7. Increase pricing only after Limn owns a recurring workflow such as My Work,
   mentions, reminders, or team review.

## Validation Questions

Before committing to packaging, answer:

- Who is the initial buyer: an individual team lead, agency owner, operations
  manager, or privacy-conscious technical team?
- How many people actively edit a typical workspace, and how many only observe or
  contribute occasionally?
- Which feature creates the first clear willingness to pay: coordination,
  automation, history, support, or managed synchronization?
- Does a workspace license remain understandable when a team uses several Limn
  workspaces?
- Can paid entitlements be implemented without requiring invasive usage tracking
  or making offline use unreliable?
- Should commercial use require payment, remain voluntary, or be governed only by
  feature-based plans?
- What support burden and infrastructure cost would Limn Sync create at the
  proposed price?

## Working Decision

The recommended direction for future evaluation is:

> Keep the local-first product free, sell a $99-per-year small-team workspace
> license, and introduce optional paid encrypted synchronization later.

