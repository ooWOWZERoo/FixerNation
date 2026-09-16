# Fixer Nation Education: Tune Your Brain

## Master Curriculum, Product Architecture, Phased Implementation Roadmap, and Claude Code Context

**Document status:** Authoritative implementation blueprint  
**Product:** Fixer Nation Education (FNE)  
**Feature family:** Tune Your Brain  
**Audience:** Product leadership, curriculum leadership, UX/design, engineering, QA, security/privacy reviewers, and Claude Code  
**Planning horizon:** Current platform through the fully realized K–12 end state  
**Working product promise:** **Learn. Think. Choose. Grow.**

---

# 1. Directive to Claude Code

This document is the controlling product and implementation blueprint for the Tune Your Brain workstream. It provides the destination, architecture, sequencing, safety boundaries, and phase gates. It is not permission to rewrite the application wholesale or to implement every phase in one session.

Claude Code must:

1. Inspect the repository and current runtime before changing code.
2. Locate and read the existing `PROJECT.md`, `CLAUDE.md`, schema/migrations, routes, authentication, classroom-PIN flow, teacher/student/admin portals, current Brain Games, progress/reward services, content management, tests, and deployment instructions.
3. Reconcile repository facts with this blueprint. Repository facts control current implementation details; this blueprint controls the intended product direction.
4. Record any genuine conflict, ambiguity, or missing dependency before implementation. Do not silently invent an answer.
5. Preserve all unrelated functionality, current routes, school licensing, classroom isolation, authentication flows, content, legal pages, analytics, integrations, and administrative controls.
6. Use additive, reversible database migrations. Never destroy or repurpose existing data to make the new model fit.
7. Extend existing shared services. Do not create parallel authentication, profile, classroom, assignment, progress, notification, reporting, reward, or permission systems.
8. Complete one approved phase or bounded work package at a time.
9. Validate each phase with automated tests, manual role-based workflows, accessibility review, responsive review, data-isolation checks, and regression testing.
10. Update project memory and handoff documentation after every phase so a future Claude Code session can resume without reconstructing decisions.

## Required project-memory files

Claude Code should maintain or create the following after repository inspection:

- `CLAUDE.md`: concise operating context, commands, protected areas, current phase, architectural rules, and non-negotiables.
- `docs/tune-your-brain/MASTER_PLAN.md`: a repository copy of this blueprint.
- `docs/tune-your-brain/CURRENT_STATE.md`: discovered routes, files, services, schema, gaps, and technical constraints.
- `docs/tune-your-brain/DECISIONS.md`: dated architecture and product decisions with rationale.
- `docs/tune-your-brain/TRACEABILITY.md`: requirement → implementation → test → status.
- `docs/tune-your-brain/CONTENT_MODEL.md`: skill, standard, engine, content-pack, media, and review-state contracts.
- `docs/tune-your-brain/PHASE_STATUS.md`: completed, in progress, blocked, deferred, and next actions.
- `docs/tune-your-brain/TEST_MATRIX.md`: automated and manual coverage by role, band, engine, device, and accessibility mode.
- `docs/tune-your-brain/SESSION_HANDOFF.md`: last completed checkpoint, files changed, migrations, test results, risks, and exact next step.

The root `CLAUDE.md` should remain concise. It should point to these detailed documents rather than duplicate the entire blueprint.

---

# 2. Source-of-Truth Order

When two sources disagree, use this order:

1. Explicit, current direction from FNE leadership.
2. This master blueprint and its later approved amendments.
3. The FNE Learning Games Curriculum & Architecture Matrix.
4. Approved functional specifications, privacy/safety specifications, and design decisions.
5. Current `PROJECT.md` and repository behavior.
6. Legacy drafts and frozen design concepts.

Specific interpretation rules:

- This is an **FNE education-platform initiative**, not a Fixer Nation consumer-membership initiative.
- Do not import consumer-site social-network, provider-directory, commerce, public-profile, or membership mechanics into student learning.
- The active FNE visual foundation is the teal/coral version with serif headings. The navy/amber v2 direction remains frozen unless leadership explicitly reactivates it.
- The current educational matrix supersedes earlier game-count suggestions where they conflict.
- The live six Brain & Thinking games are preserved and evolved; they are not the complete future curriculum.
- The separate earlier consumer-oriented list of positivity/wellness games must not be mistaken for the approved FNE K–12 Phase 1 catalog.
- Existing school-license, purchase-order, invoice/payment, effective/expiration-date, trial, renewal, and email-automation behavior is outside the game redesign and must not regress.
- Production server, mail-server, or hosting-account connectivity is not assumed or required for Claude Code work unless leadership expressly adds it to a later work package.

---

# 3. Product Vision and End State

Tune Your Brain will evolve from a small group of cognitive games into an age-adaptive K–12 learning-through-games platform that combines:

- Literacy and communication
- Mathematics and applied numeracy
- Thinking and executive skills
- Social-emotional learning and character
- Wellness and life skills
- FNE's Issues-to-Answers model
- Teacher assignments and classroom practice
- Student goals, meaningful achievements, and private personal progress
- Conservative, transparent adaptive support
- School-appropriate reporting and administration
- Reusable game engines and configuration-driven content
- Age-appropriate visual experiences that mature with the learner

The destination is not a generic arcade and not a substitute for classroom instruction. It is an instructional practice environment in which students rehearse academic, cognitive, social, emotional, and practical-life skills through developmentally appropriate play, challenges, missions, and simulations.

## Product differentiation

FNE's strongest market position is:

> **Students practice academic skills through meaningful situations involving character, wellness, decision-making, and real life.**

Examples:

- A child practices reading comprehension through a story about inclusion and perspective.
- A student practices percentages through saving and budgeting.
- A middle-school learner identifies evidence within a digital-citizenship dilemma.
- A high-school learner applies math while interpreting a paycheck and balancing expenses.
- Students use Issues-to-Answers to recognize a problem, consider impact, compare responsible options, make a choice, and reflect.

## End-state definition

The end state is achieved when:

- All four experience bands are live and visually distinct.
- All five learning domains have connected skill pathways.
- The internal skill graph supports prerequisites, progression, and standards mappings.
- Most new learning experiences can be produced through engine configuration and approved content packs, not a new codebase.
- Teachers can assign a game, skill, domain, level, scenario, or bounded adaptive pathway.
- Students receive age-respectful support and rewards without public ranking or deficit labels.
- School administrators receive aggregate adoption and engagement information, consistent with FNE's privacy model.
- Content staff can author, review, publish, version, retire, and audit content without engineering database edits.
- Accessibility, privacy, security, content safety, tenant isolation, and auditability are built into the platform.
- FNE can show what was practiced and how students engaged without claiming diagnostic, psychometric, clinical, or validated-outcome capabilities that have not been established.

---

# 4. Existing Platform Context That Must Be Preserved

Repository discovery must verify these known current-state facts rather than assuming their exact implementation:

- Production is an education-only FNE platform.
- The live application has historically used Node/Express, MariaDB, Hosting.com, and cPanel-compatible operations.
- FNE already supports school licensing, teacher classrooms, student classroom-code/username/PIN access, parent access, curriculum/content workflows, administrative functions, and current Brain Games.
- Existing current games include Memory, Reaction, Sequences, Focus, Math, and Patterns.
- Existing Brain Games already have or reference XP, levels, badges, and streaks for some account types.
- Classroom-PIN students have been able to play but have had a known gap in earning Brain Game XP, badges, or streaks.
- Playwright coverage exists but has historically required manual execution rather than mandatory CI execution.
- Existing school, teacher, student, administrator, and super-administrator roles and permissions must be extended rather than bypassed.
- FNE's daily Morning Boost curriculum, Issues-to-Answers framework, teacher resources, student reflections/goals, and reporting model must remain intact.

## Required first technical conclusion

Before planning tables or routes, Claude Code must determine whether the current stack and schema still match these remembered facts. If the repository has evolved, document the actual state. Do not force an obsolete architecture onto newer code.

---

# 5. Non-Negotiable Product and Ethical Principles

## 5.1 Development before decoration

Visuals must match the learner's developmental stage, but graphics alone do not make an experience developmentally sound. Language load, abstraction, executive demands, timing, feedback, choice structure, social context, and emotional intensity must also fit the experience band.

## 5.2 Experience band and skill level are independent

- **Experience band** controls presentation, tone, interaction, story, avatar style, reward presentation, and navigation.
- **Skill level** controls instructional complexity, prerequisite knowledge, scaffolding, number of steps, and response demands.

A seventh grader practicing an early decoding skill must receive age-respectful middle-school presentation, not a K–2 cartoon interface.

## 5.3 Asset-based language

The platform should describe growth, practice, strategy, and next steps. It must not label students by presumed intelligence, ability, diagnosis, or deficit.

Use:

- Skills practiced
- Skills growing
- Current challenge
- Next challenge
- Strategy used
- Personal best
- Progress over time

Avoid:

- IQ or brain score
- Smart/not smart
- Below average
- Failed learner
- Bad at reading/math
- Behavior problem

## 5.4 Psychological safety

- Never shame a learner for an incorrect answer.
- Never use humiliating sound, red flashing failure states, mocking animation, public rank, or lost-status theatrics.
- Permit replay, hints, and strategy change.
- For sensitive SEL scenarios, permit pause/exit without penalty.
- Avoid forcing personal disclosure to complete a game.
- Reflections are private by default and must not be repurposed as social content.
- Do not ask students to relive trauma or disclose abuse, self-harm, violence, health information, family finances, immigration status, or other sensitive facts through routine gameplay.
- When a safety disclosure mechanism is intentionally provided, route it through the separately approved FNE safety process, not ordinary game telemetry.

## 5.5 No manipulative gamification

Prohibit:

- Public student leaderboards
- Pay-to-win or paid student rewards
- Loot boxes or variable-ratio reward mechanics
- Ads, targeted advertising, or commercial profiling
- Dark patterns
- Punitive streak loss
- Artificial scarcity designed to create anxiety
- Infinite play loops without natural stopping points
- Notifications designed primarily to maximize time on platform

Rewards should reinforce competence, effort, strategy, reflection, contribution, and completion of meaningful learning goals.

## 5.6 Evidence discipline

Until separately validated, FNE must not claim that games:

- Diagnose learning disabilities or mental-health conditions
- Assess reading level in a validated sense
- Determine intelligence or aptitude
- Prove mastery from one short session
- Provide a clinical intervention
- Measure CASEL competencies as a validated assessment
- Improve academic or behavioral outcomes without supporting evidence

The platform may accurately state what a learner practiced, the response evidence observed, what support was used, and how performance changed within FNE activities.

## 5.7 Human control

Teachers need visible controls to assign, lock, adjust, override, pause, retry, and interpret learning activities. Adaptivity assists; it does not replace educator judgment.

---

# 6. Instructional and SEL Design Model

## 6.1 Five integrated learning domains

1. **Literacy & Communication**
2. **Math & Applied Numeracy**
3. **Thinking & Executive Skills**
4. **SEL & Character**
5. **Wellness & Life Skills**

## 6.2 Learning-science design rules

Games should use learning science deliberately rather than layering points onto ordinary worksheets.

- **Retrieval:** Ask learners to recall or apply knowledge rather than only recognize what was just shown.
- **Spacing:** Revisit important skills across sessions instead of requiring one massed session.
- **Interleaving:** Mix related problem types after initial instruction so the learner must choose a strategy.
- **Worked examples:** Model a complete solution before expecting independent performance, especially for novices.
- **Fading:** Reduce prompts and scaffolds as the learner demonstrates consistent success.
- **Immediate explanatory feedback:** Correct misconceptions close to the response while still requiring the learner to think.
- **Desirable variation:** Change surface details and context so success reflects transferable understanding rather than memorized item order.
- **Cognitive-load control:** Remove decorative distraction, limit simultaneous instructions, and reveal complexity progressively.
- **Metacognition:** Ask the learner to identify the strategy, clue, or reason that helped, without turning every round into a writing assignment.
- **Transfer:** Include selected opportunities to apply the same skill in a new academic or life context.
- **Agency:** Offer meaningful choices in path, representation, avatar, or strategy without allowing students to bypass the learning target.

Randomization must be instructionally constrained. It must not create impossible combinations, repeat the same item excessively, break a phonics scope/sequence, change the intended difficulty, or make two students' assigned work incomparable without recording the variation.

## 6.3 Four experience bands

| Band | Default grades | Learner promise | Presentation |
|---|---:|---|---|
| **Discover** | K–2 | I can try, notice, and learn | Guided illustrated world; animals, robots, young explorers; spoken support; large interactions |
| **Explore** | 3–5 | I can explore and solve | Adventure maps, worlds, companions, collections, missions, growing independence |
| **Challenge** | 6–8 | I can plan, decide, and improve | Modern mission UI, stylized avatars, strategy, identity, skill paths, restrained animation |
| **Advance** | 9–12 | I can apply learning to real life | Mature app-style simulations, realistic decisions, dashboards, evidence, reflection |

Grade bands are defaults, not ability labels. Teachers may override presentation when appropriate.

## 6.4 CASEL-aligned, not CASEL-certified

The SEL content model should map internally to the five broad CASEL competency areas:

- Self-awareness
- Self-management
- Social awareness
- Relationship skills
- Responsible decision-making

Mapping is used for curriculum organization and transparency. It does not imply CASEL review, certification, endorsement, or validated measurement.

## 6.5 Developmental SEL progression

### Discover

- Name common emotions with nuance appropriate to age.
- Notice body and situational cues without declaring that one expression always means one feeling.
- Practice simple pause, ask, share, include, repair, and seek-help behaviors.
- Distinguish accidental harm from intentional behavior only when the scenario provides enough evidence.
- Recognize that more than one helpful response may exist.

### Explore

- Compare perspectives and likely impact.
- Practice friendship repair, inclusion, cooperation, and early digital citizenship.
- Separate intention from impact.
- Identify trusted-adult help as a responsible option.
- Reflect on strategies without forced autobiography.

### Challenge

- Analyze ambiguity, peer pressure, group dynamics, online behavior, boundaries, conflict, and consequences.
- Evaluate short- and long-term impact.
- Practice assertive communication, listening, repair, help-seeking, and responsible digital decisions.
- Recognize that context can change which response is most constructive.

### Advance

- Navigate realistic school, work, relationship, financial, leadership, and digital-life decisions.
- Weigh competing responsibilities, values, power differences, and incomplete information.
- Build communication plans and evaluate consequences.
- Practice reflection without pretending that a simulation proves real-world character.

## 6.6 FNE Issues-to-Answers gameplay cycle

The reusable branching scenario engine must preserve the FNE sequence:

1. **Recognize the Issue** — What is happening? What facts are known?
2. **Understand the Impact** — Who may be affected, and how?
3. **Consider Possible Answers** — What options exist? What support or information may be needed?
4. **Choose a Responsible Response** — Which response is constructive in this context, and why?
5. **Reflect and Reinforce** — What principle or strategy can transfer to another situation?

### Scenario-scoring rule

SEL is not a trivia contest. Content authors must be able to mark:

- Clearly unsafe/harmful options
- Plausible but incomplete options
- Responsible options
- Multiple defensible responsible options
- Context-dependent options
- Seek-help/escalation options

Feedback should explain impact and tradeoffs. It should not merely say “correct” or “wrong.”

### Sensitive-scenario rules

- Avoid graphic or sensational content.
- Do not make the student responsible for fixing serious danger alone.
- Present trusted-adult or emergency help where developmentally appropriate.
- Never promise confidentiality the platform cannot provide.
- Do not treat a game choice as evidence that the learner has engaged in the behavior.
- Keep scenario response data separate from any intentional safety-reporting channel.

## 6.7 Learning loop for every instructional game

Every game should implement an age-appropriate version of:

1. **Orient** — concise goal and why it matters.
2. **Model** — demonstration or worked example.
3. **Practice** — low-risk guided attempt.
4. **Challenge** — independent or lightly supported application.
5. **Feedback** — immediate, specific, actionable explanation.
6. **Retry or vary** — another attempt that supports retrieval and transfer, not answer memorization.
7. **Reflect/transfer** — short connection to another problem or life context when appropriate.
8. **Close** — progress summary and a natural stopping point.

## 6.8 Feedback hierarchy

Preferred feedback order:

1. Confirm what the learner did effectively.
2. Identify the specific mismatch or missing step.
3. Offer a cue or strategy.
4. Allow a retry with changed surface details.
5. Show an explanation or worked example after bounded attempts.
6. Record support used so the teacher can distinguish independent success from supported success.

Speed should not dominate scoring unless automaticity or fluent response is the explicit learning objective. Accommodations and reduced-motion modes must not reduce academic credit.

---

# 7. Visual, Interaction, Graphics, and Audio Direction

## 7.1 Shared visual foundation

- Preserve the active FNE teal/coral visual identity and serif-heading character.
- Create experience-band extensions rather than four unrelated brands.
- Use design tokens for color, typography, spacing, motion, elevation, focus, success, warning, and instructional feedback.
- Do not use color alone to express correctness, domain, difficulty, or status.
- Keep celebratory effects brief, optional, and compatible with reduced motion.

## 7.2 Discover art direction

**Design:** illustrated, warm, clear, friendly, low-clutter.

**Characters:** owl, fox, turtle, dolphin, dog, cat, panda, friendly robot, astronaut, young explorer.

**Environments:** classroom, park, home, garden, nature, space, simple town, calm cloud world.

**Interaction:** large targets, few choices, drag alternatives, tap/click alternatives, spoken directions, visual modeling, short rounds.

**Animation:** expressive but not frenetic; no startling sound or failure reactions.

## 7.3 Explore art direction

**Design:** illustrated adventure, discovery maps, richer scenes, moderate information density.

**Characters:** child explorer avatars and optional companion creatures.

**Environments:** islands, laboratories, mysteries, shops, kitchens, libraries, nature expeditions, world maps.

**Progress presentation:** destinations, collections, skill pathways, mission cards, unlockable environments.

## 7.4 Challenge art direction

**Design:** modern mission interface with geometric forms, deeper palette, controlled gradients, and mature iconography.

**Characters:** stylized human avatars with age-respectful proportions.

**Environments:** mission control, modern school, city spaces, devices, strategy maps, social situations.

**Progress presentation:** XP, titles, mission paths, personal milestones, and skill achievements without public ranking.

## 7.5 Advance art direction

**Design:** polished consumer-app and simulation style with strong typography, restrained color, data views, and realistic illustration.

**Characters:** mature illustrated profiles with clothing, interests, background, and achievement frames.

**Environments:** workplace, apartment/home, banking, transportation, college/training, schedule, team communication, financial dashboard.

**Progress presentation:** accomplishments, credentials where appropriate, simulation outcomes, and advanced challenges. Avoid juvenile badges and confetti.

## 7.6 Avatar continuity

When a learner transitions bands, preserve achievements, history, and earned rewards. Invite the learner to customize a newly mature presentation. Never erase earlier progress or force older students to display elementary assets.

## 7.7 Asset-library requirements

Assets must be tagged by:

- Asset ID and version
- Experience band
- Domain and theme
- Character/environment/object type
- Cultural/identity representation attributes used for editorial balance, not student inference
- Alt text or decorative status
- Motion status and reduced-motion substitute
- Audio transcript/caption
- License/source/creator
- Approval and retirement state

Do not infer a student's race, ethnicity, disability, gender identity, or other sensitive characteristic from appearance or avatar choices.

## 7.8 Audio is instructional content

Professionally controlled audio is required for foundational literacy:

- Individual phonemes
- Letter names and letter sounds as distinct assets
- Blends and digraphs
- Syllables
- Example words
- Spoken directions
- Corrective feedback

Browser text-to-speech may support general narration or accessibility, but must not be the only source for phonics content. Each audio asset requires a transcript or accessible instructional equivalent. The content workflow must review pronunciation, dialect treatment, clarity, pacing, and consistency.

---

# 8. Accessibility and UDL Requirements

Target **WCAG 2.2 AA** for the product interface and game mechanics, while recognizing that automated checks alone cannot establish conformance.

Apply CAST UDL 3.0 as a design framework by providing multiple means of:

- Engagement
- Representation
- Action and expression

Every game must support, where applicable:

- Keyboard-only operation
- Touch and mouse operation
- Visible, unobscured focus
- Logical focus order
- Screen-reader labels and status announcements
- Text alternatives for meaningful graphics
- Captions/transcripts
- Volume control and mute
- Reduced motion
- Adjustable or non-timed mode when speed is not the learning target
- Pause and resume
- Replay directions and audio
- Minimum target sizes consistent with WCAG 2.2
- A non-drag alternative for dragging interactions
- Sufficient contrast
- Zoom/reflow without loss of function
- Error identification beyond color or sound
- Authentication that does not create unnecessary cognitive barriers

Never require color alone, audio alone, fine motor precision alone, rapid response alone, or reading ability unrelated to the learning objective.

Accessibility alternatives must measure the same intended construct. For example, replacing a spatial-geometry activity with a text-only trivia question is not equivalent.

---

# 9. Platform Architecture

## 9.1 Architectural principle

Build a composable learning platform:

```text
Experience Shell
    + Game Engine
    + Skill and Difficulty Rules
    + Versioned Content Pack
    + Media/Audio Theme
    + Assignment/Progress Services
    + Reporting/Reward Services
    = Playable Learning Experience
```

## 9.2 Major components

1. **Experience Shells** — Discover, Explore, Challenge, Advance presentation and navigation.
2. **Learning Domain/Skill Graph** — internal skills, prerequisites, levels, and mappings.
3. **Game Engine SDK** — reusable mechanics and lifecycle contract.
4. **Content Pack System** — versioned instructional content and media.
5. **Assignment Service** — teacher-selected game/skill/domain/pathway work.
6. **Session and Evidence Service** — server-authoritative sessions, attempts, responses, supports, and completion.
7. **Progression Service** — transparent bounded difficulty recommendations and teacher overrides.
8. **Reward Service** — achievements, badges, XP or band-appropriate equivalents.
9. **Reporting Service** — student, teacher, administrator, and operational views.
10. **Content Administration** — draft, review, approval, publishing, retirement, rollback.
11. **Audit and Reset Service** — permissioned, confirmed, scoped, logged changes.

## 9.3 Reusable engine catalog

| Engine | Core mechanic | Required variations |
|---|---|---|
| Audio Choice | Listen and select | Replay, transcript/equivalent, image/text options |
| Match | Connect related concepts | Keyboard pairing, non-drag list mode |
| Sort | Categorize items | Tap-to-place and keyboard mode |
| Sequence | Order items | Drag and numbered/select mode |
| Build | Construct words, sentences, equations, or plans | Tile, keyboard, accessible list modes |
| Manipulative | Move quantities/shapes | Direct-entry equivalent |
| Pattern | Infer and apply a rule | Visual and described alternatives where valid |
| Memory | Recall locations/items/sequences | Configurable load, non-speed mode |
| Evidence Hunt | Identify support in text/media | Highlight, select, cite, explain |
| Branching Scenario | Choice, consequence, feedback, reflection | Multi-defensible answers, context metadata |
| Strategy | Plan under constraints | Undo, preview, step feedback |
| Simulation | Manage a system over time | Save/resume, decision log, debrief |
| Guided Activity | Follow structured attention/wellness steps | Skip/pause, captions, no medical claims |
| Quest | Complete a bounded goal | School-safe tasks, verification rules |

## 9.4 Engine lifecycle contract

Each engine should expose a common lifecycle such as:

```text
initialize → orient → model → startSession → presentItem
→ acceptResponse → evaluate → feedback → retry/advance
→ completeRound → summarize → closeSession
```

Common engine responsibilities:

- Load only approved, active content versions.
- Respect experience shell, accessibility settings, teacher overrides, and assignment bounds.
- Use deterministic content/version identifiers for audit and replay.
- Emit normalized learning events.
- Prevent client-side reward or score forgery.
- Resume safely after interruption.
- Avoid duplicate completion/reward events through idempotency.
- Provide a clean natural stopping point.

## 9.5 Content pack contract

At minimum, each content item/version should include:

- Content ID and version
- Title and internal description
- Engine and supported engine version
- Experience band presentation metadata
- Learning domain
- Primary skill ID
- Supporting/cross-domain skill IDs
- Prerequisite skill IDs
- Difficulty band
- Grade guidance
- Learning objective
- Prompt/instructions
- Stimulus and media references
- Audio references
- Response configuration
- Correctness or response-quality rubric
- Multiple-defensible-answer metadata where relevant
- Feedback and explanation
- Hints/scaffolds in ordered levels
- Transfer/reflection prompt when relevant
- FNE theme and Issues-to-Answers step where relevant
- Standards mappings
- Accessibility alternatives
- Sensitivity/content-safety tags
- Estimated time
- Randomization constraints
- Author/reviewer/approver
- Draft/review/approved/published/retired state
- Effective and retired dates
- Change notes

## 9.6 Internal skill graph

Skills are independent of grade and standards systems. Example:

```text
LIT.PHON.AWARENESS
  → LIT.PHON.INITIAL_SOUND
  → LIT.LETTER_SOUND
  → LIT.BLEND.CVC
  → LIT.DECODE.CVC
  → LIT.DECODE.BLENDS
  → LIT.DECODE.MULTISYLLABLE
  → LIT.FLUENCY
  → LIT.COMPREHENSION
```

Each skill stores:

- Stable internal ID
- Name and learner-facing label
- Definition and boundaries
- Domain/subdomain
- Prerequisites and related skills
- Typical grade guidance
- Difficulty continuum
- Suitable engines
- Observable evidence types
- Scaffolding strategies
- External standards mappings
- Active/version status

Do not hard-code games directly to Common Core, Pennsylvania Core, or a single district framework. Map FNE skills to external standards through a separate versioned crosswalk.

## 9.7 Recommended conceptual entities

Exact table names must follow repository conventions after discovery. The model must support:

- Experience bands and themes
- Domains, subdomains, skills, prerequisites, and skill versions
- Standards frameworks, standards, and mappings
- Engines and engine versions
- Game definitions and versions
- Content packs, items, item versions, and variants
- Media/audio assets and accessibility alternatives
- Review workflows and approvals
- Assignments, targets, due windows, and accommodations
- Sessions, attempts, responses, supports/hints, events, and completions
- Skill evidence and bounded progression state
- Teacher overrides and student accessibility/preferences
- Goals, badges, badge criteria, rewards, and award events
- Cooperative classroom milestones
- Reporting aggregates
- Reset requests/results and immutable audit records
- Feature flags and pilot cohorts

## 9.8 Learning event model

Normalized events should include only information necessary for instruction, operations, audit, and approved analytics.

Typical events:

- Session started/resumed/completed/abandoned
- Item presented
- Response submitted
- Hint requested
- Feedback displayed
- Retry attempted
- Skill evidence recorded
- Difficulty adjusted or suggested
- Teacher override applied
- Assignment completed
- Badge/achievement awarded or revoked
- Progress reset

Each event should include stable tenant, user, role, assignment, game, engine, skill, content-version, timestamp, session, and idempotency references where applicable. Do not place free-text student reflections or unnecessary PII into general analytics events.

---

# 10. Identity, Tenancy, Permissions, Privacy, and Safety

## 10.1 Reuse existing identity and tenancy

- Use current user, school, classroom, teacher, student, and administrator identities.
- Enforce school and classroom isolation server-side on every read and write.
- Treat classroom-code/username/PIN students as first-class student identities within their authorized school/classroom boundary.
- Do not solve the PIN-student reward gap by weakening authentication, creating shadow profiles, or storing authority in the browser.

## 10.2 Role-specific visibility

| Role | Visibility |
|---|---|
| Student | Own progress, goals, private personal bests, skills practiced, badges, next challenges |
| Teacher | Authorized students' assignments, attempts, accuracy/response quality, hints, completion, skill evidence, progression, and support needs |
| Primary School Admin | Existing full school-license administration plus aggregate Tune Your Brain adoption/engagement within approved policy |
| Secondary School Admin | Existing delegated management/invitation authority but cannot revoke the Primary Admin; aggregate Tune Your Brain views within approved policy |
| Read Only School Admin | View/report-only access; no assignment, content, user, license, reset, or configuration mutation |
| School Safety Admin | Only separately routed safety incidents and functions authorized by the safety specification |
| FNE Admin/Super Admin | Permissioned support and operational visibility with audit logging; no casual unrestricted access |

School administrators receive aggregate participation, classroom usage, domain activity, assignment completion, and engagement trends. They must not automatically receive individual student grades, detailed attempt histories, private reflections, or other student-level detail where current FNE policy excludes it.

## 10.3 Data minimization

- Collect only the information needed for the educational service.
- Keep instructional events, reflections, safety reports, and general analytics logically separated.
- Do not sell student data or use it for targeted advertising.
- Do not create advertising profiles.
- Do not expose raw student data to third parties without approved educational purpose, contract, controls, and review.
- Define retention by data class; do not retain detailed event streams indefinitely by default.
- Support school-controlled access, correction, export, and deletion obligations through approved processes.

## 10.4 FERPA/COPPA design posture

The implementation must be reviewed against current legal and contractual requirements before production. As a design baseline:

- Use student information only for the school-authorized educational purpose.
- Maintain school/district control and least-privilege access.
- Prohibit secondary commercial use and targeted advertising.
- Maintain clear notice, retention, deletion, security, and redisclosure controls.
- Apply current COPPA requirements for users under 13 and current FERPA obligations for education records.
- Do not assume that a school relationship removes every parental-notice or consent responsibility.

## 10.5 Security requirements

- Server-side authorization for every protected action.
- Parameterized queries/ORM-safe operations and schema validation.
- CSRF, XSS, injection, session, rate-limit, and abuse protections consistent with the existing platform.
- Encryption in transit and appropriate protection at rest.
- Secrets only in approved environment configuration.
- No student PII in logs, exception messages, URLs, or analytics payloads.
- Audit privileged access, resets, content publishing, role changes, and exports.
- Backups and migration rollback procedures verified before production changes.

## 10.6 Safety boundary

Ordinary gameplay is not the reporting channel for urgent student safety concerns. If a game includes open text or future social interaction, route it through the approved centralized content-safety gateway. Preserve the existing principles of fail-closed moderation, role-based incident routing, limited retention, and separation between teacher visibility and designated school safety recipients.

---

# 11. Adaptive Learning and Progression

## 11.1 Conservative launch model

Starting point:

- Grade/class context
- Teacher-selected skill or level
- Existing FNE activity history, where appropriate
- Explicit accommodations/preferences

During play, the system may consider:

- Accuracy or rubric quality
- Attempts
- Hint/scaffold usage
- Error pattern
- Consecutive independent success
- Response consistency
- Time only when relevant to the skill

## 11.2 Allowed adaptations

- Change item difficulty within an assigned skill range.
- Add or remove a scaffold.
- Reduce distractor complexity.
- Provide a worked example.
- Offer another example with changed surface details.
- Suggest a prerequisite or next-linked skill.
- Recommend teacher review after persistent struggle.

## 11.3 Teacher controls

Teachers must be able to:

- Lock a level
- Lock a specific skill
- Assign an allowed skill range
- Enable/disable adaptive mode
- Move a learner up/down
- Assign the same configuration to a group
- Preview the exact learner experience
- See when and why the system adjusted
- Override the recommendation

## 11.4 Mastery language and rules

Do not use a single opaque “mastery score.” Maintain evidence states such as:

- Not yet practiced
- Practicing with support
- Showing consistency
- Ready for a new challenge
- Teacher-confirmed/assigned review

Exact thresholds must be configurable by skill and pilot-tested. Do not hard-code one universal percentage across phonics, budgeting, memory, and SEL scenarios.

Adaptation decisions must be explainable in plain language, logged, reversible, and bounded by teacher assignment.

---

# 12. Rewards, Goals, Badges, and Motivation

## 12.1 Reward principle

Reward evidence of learning, strategy, persistence, reflection, healthy help-seeking, and meaningful contribution. Avoid making raw time, clicks, or repeated low-value play the primary achievement.

## 12.2 Band-specific rewards

### Discover

- Stickers, stars, companion accessories, room items, outfits, colorful skill badges, brief celebration.

### Explore

- Adventure items, map destinations, companion items, collections, achievement cards, new environments.

### Challenge

- XP, titles, profile frames, avatar cosmetics, skill badges, mission unlocks.

### Advance

- Accomplishments, advanced challenges, mature profile frames, skill milestones, certificates only where criteria are defensible.

## 12.3 Badge quality

Good badges communicate what the learner achieved:

- Sound Explorer
- Context Detective
- Problem Solver
- Perspective Builder
- Responsible Responder
- Budget Builder
- Digital Citizen
- Leadership Builder

Avoid badges whose only meaning is excessive use.

## 12.4 No public individual leaderboards

Use private personal bests and cooperative classroom milestones:

- The class practiced 500 words.
- The classroom completed 100 kindness missions.
- The class explored all five learning domains.

Cooperative goals must not reveal which students contributed least or pressure students to disclose performance.

## 12.5 Server-authoritative rewards

The server determines completions, XP, badges, and unlocks from validated events. Reward writes must be idempotent, auditable, and compatible with classroom-PIN students.

---

# 13. Teacher, Student, and Administrator Experiences

## 13.1 Student hub

The authenticated Tune Your Brain hub should provide:

- Continue assigned work
- Teacher-assigned activities
- Recommended next challenge within allowed bounds
- Five domains
- Current goals
- Recent accomplishments
- Personal avatar/profile
- Accessible settings
- Clear time/round expectations
- A natural stop/return-to-classroom action

Do not create a public student social profile.

## 13.2 Teacher workflow

Teachers can assign:

- A specific game
- A specific skill
- A skill level/range
- A domain and practice duration
- An FNE scenario
- A bounded adaptive pathway

Assignment targets:

- Classroom
- Teacher-authorized group
- Individual student

Teacher reporting must distinguish:

- Completion from proficiency evidence
- Independent from hinted/scaffolded performance
- First attempt from later attempts
- Assigned work from voluntary practice
- Accuracy from speed
- Academic response evidence from SEL reflection

## 13.3 Administrator workflow

School administrators see aggregate information consistent with current FNE policy:

- Adoption and active classrooms
- Participation and completion
- Domain and skill-family engagement
- Assignment utilization
- Accessibility feature use only in non-identifying aggregate where appropriate
- Trends over time

Do not introduce individual student grades or detailed PII into administrator dashboards if the current FNE model excludes it.

## 13.4 Reset and correction

Authorized FNE Admin/Super Admin users may reset:

- A specific game/session
- An assignment result
- A skill progression state
- A badge/award
- Game history
- All Tune Your Brain progress

Every destructive action must:

- Show exact scope
- Require confirmation
- Preserve unrelated FNE data
- Use a transaction where appropriate
- Create an immutable audit record
- Record actor, reason, target, before/after scope, result, and timestamp

Teachers receive narrower retry/reset permissions aligned to classroom authority.

---

# 14. Phase 1 Experience Catalog

Phase 1 must prove the architecture across all four experience bands, all five domains, multiple engine types, assignment/reporting, rewards, audio, accessibility, and conservative adaptation.

It includes 12 new flagship experiences plus migration of the six existing Brain & Thinking games. Delivery occurs in waves rather than as one large release.

## 14.1 Discover flagship games

### Sound Safari

- **Primary target:** phoneme identification and initial/final sounds.
- **Engine:** Audio Choice.
- **Core loop:** hear a controlled sound → inspect illustrated choices → select → receive articulatory/word feedback → retry with a new example.
- **Developmental design:** animal/explorer guide, 3–4 choices, short rounds, no reading required.
- **Evidence:** sound target, chosen response, replay count, hint use, independent/supported result.
- **Media:** professionally recorded phonemes/words, diverse familiar objects, transcript/equivalent.
- **Acceptance:** distinguishes letter name from letter sound; keyboard/touch supported; audio replay does not penalize score.

### Word Builder

- **Primary target:** letter-sound relationships, blending, decoding.
- **Engine:** Build.
- **Core loop:** hear/see a target → arrange grapheme/sound tiles → blend → receive feedback → read a connected word/sentence where appropriate.
- **Developmental design:** manipulable tiles, tap-to-place alternative, modeled blending.
- **Evidence:** tile sequence, attempts, scaffold level, successful blend stage.
- **Media:** controlled phonics audio and simple illustrations.
- **Acceptance:** follows the explicit D1–D7 foundational reading progression; content is decodable for the assigned skill.

### Number Garden

- **Primary target:** counting, numeral recognition, quantity, early operations.
- **Engine:** Manipulative/Choice.
- **Core loop:** count or combine objects → select/build quantity → garden visibly grows.
- **Developmental design:** calm garden, concrete-to-representational progression, no speed pressure.
- **Evidence:** quantity, strategy representation, attempts, support.
- **Cross-domain:** care, patience, growth.
- **Acceptance:** objects remain countable and accessible at zoom; direct-entry equivalent exists.

### Feelings Detective

- **Primary target:** emotion vocabulary, contextual cues, perspective.
- **Engine:** Scenario Choice.
- **Core loop:** view brief illustrated context → notice face/body/situation cues → select possible feeling(s) → learn that context and perspective matter.
- **Developmental design:** never teach that facial expression alone proves emotion.
- **Evidence:** cue identification and reasoning level, not diagnosis.
- **Acceptance:** allows more than one plausible feeling when scenario supports ambiguity; includes help-seeking in appropriate situations.

## 14.2 Explore flagship games

### Reading Detective

- **Primary target:** main idea, inference, evidence.
- **Engine:** Evidence Hunt.
- **Core loop:** read/listen to short mystery or meaningful story → answer → identify supporting clue → explain with structured choice.
- **Cross-domain:** inclusion, empathy, responsibility.
- **Evidence:** answer, selected evidence, attempts, supports, transfer item.
- **Acceptance:** a correct guess without evidence is recorded differently from evidence-supported success.

### Fraction Kitchen

- **Primary target:** fraction meaning, equivalence, comparison, operations at later levels.
- **Engine:** Manipulative.
- **Core loop:** use recipe quantities and visual models → combine/compare → serve completed recipe.
- **Developmental design:** rich kitchen/adventure scene; direct numeric and non-drag controls.
- **Evidence:** representation used, result, hints, misconception category.
- **Acceptance:** visuals preserve proportional accuracy; incorrect feedback identifies the fraction concept, not just the answer.

### Choice Quest

- **Primary target:** Issues-to-Answers, empathy, responsible decision-making.
- **Engine:** Branching Scenario.
- **Core loop:** encounter school/life situation → recognize issue → identify impact → compare options → choose/justify → see consequences → reflect.
- **Developmental design:** adventure presentation with multiple constructive options.
- **Evidence:** framework steps completed, quality rubric, support used; private reflection stored separately.
- **Acceptance:** no forced personal disclosure; context-dependent answers supported.

## 14.3 Challenge flagship games

### Headline

- **Primary target:** main idea, author's purpose, media/reading comprehension.
- **Engine:** Evidence Hunt.
- **Core loop:** inspect age-appropriate short article/post → choose accurate headline/summary → identify evidence and missing context.
- **Cross-domain:** digital citizenship and perspective.
- **Evidence:** claim/evidence match, distractor pattern, explanation.
- **Acceptance:** avoids partisan persuasion and presents sources/context fairly; content is reviewed and versioned.

### Money Moves

- **Primary target:** percentages, budgeting, saving, needs/wants, tradeoffs.
- **Engine:** Simulation.
- **Core loop:** receive fictional goal/resources → allocate → respond to bounded events → review outcome and tradeoffs.
- **Developmental design:** mission dashboard, fictional data, no collection of family finances.
- **Evidence:** calculations, plan constraints, decision log, revisions.
- **Acceptance:** more than one viable budget may succeed; financial values are not moralized.

### Decision Point

- **Primary target:** Issues-to-Answers for peer, digital, school, and responsibility scenarios.
- **Engine:** Branching Scenario.
- **Core loop:** investigate ambiguous situation → separate facts/assumptions → examine impact → choose communication/help strategy → reflect.
- **Evidence:** reasoning steps and response qualities; never infer real behavior from choice.
- **Acceptance:** supports assertive boundaries, help-seeking, repair, and multiple responsible choices.

## 14.4 Advance flagship games

### Critical Read

- **Primary target:** critical comprehension, claims, evidence, bias/context, source reasoning.
- **Engine:** Evidence/Investigation.
- **Core loop:** analyze complex but bounded materials → identify claims → evaluate support → note uncertainty → construct conclusion.
- **Cross-domain:** digital citizenship, perspective, responsible interpretation.
- **Evidence:** claim/evidence relationships, source reasoning, revision after feedback.
- **Acceptance:** does not reduce credibility to a simplistic single signal; distinguishes fact, inference, opinion, and uncertainty.

### Money Matters

- **Primary target:** budgeting, interest, credit, loans, tradeoffs, financial resilience.
- **Engine:** Simulation.
- **Core loop:** manage a fictional financial plan through realistic decisions → inspect consequences → revise.
- **Developmental design:** mature financial dashboard; fictional personas; no solicitation or financial advice.
- **Evidence:** calculations, constraints, decision rationale, revised plan.
- **Acceptance:** presents multiple life pathways respectfully; avoids shaming poverty or equating wealth with character.

## 14.5 Existing game migration

Preserve and evolve:

- Memory → **Memory Lab**
- Reaction → **Reaction Challenge**
- Sequences → **Sequence Lab**
- Focus → **Focus Lab**
- Patterns → **Pattern Lab**
- Math → mechanics reused in age-specific Math & Applied Numeracy experiences, while preserving existing access until migration is verified

Each existing game needs:

- Engine classification
- Skill/objective statement
- Band-appropriate skin
- Accessibility remediation
- Normalized events
- PIN-student progression/reward support
- Server-authoritative scoring/rewards
- Legacy-data migration or preservation plan
- Regression tests showing existing users do not lose earned progress

---

# 15. Phased Implementation Roadmap

No phase begins implementation until the previous phase's exit gate is documented, unless leadership explicitly authorizes parallel work and dependencies are isolated.

## Phase 0 — Repository Forensics and Baseline

### Goal

Establish a verified current state and protect the live platform.

### Work

- Inventory routes, page families, game files, services, schema, migrations, APIs, authentication, roles, tenancy filters, session handling, progress, rewards, assignments, notifications, analytics, content management, tests, and deployment.
- Run the application and current test suite using documented commands.
- Capture current Brain Games behavior for normal and classroom-PIN students.
- Trace existing XP, badge, streak, score, reset, and admin flows.
- Identify current design tokens/assets and frozen v2 files.
- Identify data-retention, export, logging, and audit mechanisms.
- Identify browser support, responsive breakpoints, and accessibility gaps.
- Create current-state diagrams and the do-not-break inventory.

### Deliverables

- `CURRENT_STATE.md`
- Architecture/data-flow diagram
- Route/role matrix
- Current schema map
- Protected-functionality inventory
- Known gaps/risks
- Baseline screenshots and test results
- Proposed phase-by-phase file impact

### Exit gate

- No unresolved uncertainty about where identities, tenants, progress, rewards, and assignments are authoritative.
- Current app can be built/run.
- Baseline tests are recorded, including existing failures.
- Leadership can see exactly what Phase 1 would change.

## Phase 1 — Architectural Foundation and Data Contracts

### Goal

Create the minimum additive model needed for scalable engines, skills, content, sessions, and auditability.

### Work

- Define stable internal skill IDs and versioning.
- Define domain, experience-band, engine, game-definition, content-pack, content-item, media, standards-mapping, review-state, session, attempt, response, skill-evidence, assignment, adaptation, and reward contracts.
- Build additive migrations and rollback plans.
- Implement server-side schema validation and idempotency patterns.
- Build feature flags for internal, pilot, and general availability.
- Resolve classroom-PIN student linkage to progression and rewards without parallel profiles.
- Define telemetry allowlist and prohibit sensitive/free-text leakage.
- Add immutable privileged-action audit patterns where absent.

### Deliverables

- `CONTENT_MODEL.md`
- Schema/migrations
- API contracts/types
- Permission/data-classification matrix
- Seed strategy for domains/bands/skills/engines
- Migration/backfill plan for existing games
- Contract tests

### Exit gate

- Additive migrations apply and roll back safely in a test copy.
- Tenant isolation and permissions tests pass.
- PIN students can be represented correctly in progress/rewards.
- No duplicate identity or progression system has been created.

## Phase 2 — Shared Design System and Four Experience Shells

### Goal

Establish age-respectful presentation without duplicating business logic.

### Work

- Extend FNE tokens for four bands.
- Build shared layout, game header, instructions, progress, feedback, hint, pause, exit, summary, and accessibility controls.
- Build band-specific navigation/presentation shells.
- Create avatar continuity model and starter assets/placeholders.
- Establish reduced-motion, audio, caption, keyboard, focus, and non-drag patterns.
- Create responsive views for student devices and common school screen sizes.

### Deliverables

- Component library/storybook or repository-equivalent showcase
- Four shell prototypes
- Accessibility interaction patterns
- Graphics/audio asset manifest
- Visual regression baselines

### Exit gate

- The same sample activity renders appropriately in all four bands.
- Keyboard, screen-reader basics, reduced-motion, zoom/reflow, touch, and non-drag alternatives are demonstrated.
- Active FNE branding remains recognizable.

## Phase 3 — Game Engine SDK and Normalized Session Runtime

### Goal

Prove that multiple games can share mechanics, lifecycle, telemetry, scoring, feedback, and resume behavior.

### Work

- Implement the common lifecycle contract.
- Build an engine registry and version compatibility checks.
- Implement initial engines: Audio Choice, Build, Manipulative, Evidence Hunt, Branching Scenario, and Simulation.
- Implement normalized session/events and server-authoritative completion/reward hooks.
- Add save/resume, retry, hint, explanation, and natural-stop behaviors.
- Build test harnesses with synthetic content packs.

### Deliverables

- Engine SDK/contracts
- Six initial reusable engines
- Synthetic demo content
- Event/session service
- Authoring validation schemas
- Automated engine and lifecycle tests

### Exit gate

- At least two distinct content packs run on one engine without engine-code changes.
- One experience can run under two age shells with the same underlying skill/content logic.
- Refresh/reconnect/resume does not duplicate sessions or rewards.

## Phase 4 — Curriculum Foundation, Skill Graph, and Content Governance

### Goal

Make instructional content versioned, reviewable, traceable, and standards-portable.

### Work

- Seed five domains and foundational skill graph.
- Implement standards abstraction and initial Common Core/Pennsylvania mappings as approved content, not hard-coded logic.
- Build content pack loader/validator.
- Implement draft → review → approved → published → retired states.
- Implement reviewer roles and separation of author/approver for production publishing where feasible.
- Create rubrics for academic items, SEL scenarios, accessibility, cultural/identity review, safety, and audio.
- Establish content change/version rules so historical sessions preserve the version presented.

### Deliverables

- Initial skill graph
- Standards framework/crosswalk model
- Content schemas and validation
- Content governance workflow
- Review checklists
- Seed packs for the first vertical slice

### Exit gate

- An author can create a draft pack, validate it, obtain review/approval, publish it, and later retire it without changing code.
- Historical records still point to the content version actually played.

## Phase 5 — Vertical Slice Pilot

### Goal

Prove the full learning loop from teacher assignment to student play to teacher interpretation.

### Recommended vertical slice

- Discover: **Sound Safari**
- Explore: **Reading Detective**
- Challenge: **Decision Point**
- Advance: **Money Matters**

This combination tests audio/phonics, evidence, SEL branching, simulation, all four shells, and multiple data types.

### Work

- Build production-quality content for a bounded set of levels.
- Teacher preview and assignment.
- Student launch through existing classroom flow.
- Session/evidence capture.
- Private progress and band-appropriate rewards.
- Teacher report distinguishing completion, independent success, support, and response evidence.
- Administrator aggregate participation only.
- Reset/retry and audit path.

### Exit gate

- End-to-end flows pass for every relevant role and PIN student.
- No cross-tenant access is possible in tests.
- Curriculum, SEL, accessibility, privacy, and technical reviewers approve the slice.
- Pilot telemetry is sufficient to identify usability/content issues without unnecessary PII.

## Phase 6 — Assignments, Progression, Goals, Rewards, and Reporting

### Goal

Complete the shared learning services before scaling the game catalog.

### Work

- Assignment by game, skill, range, domain, duration, scenario, individual, group, and class.
- Teacher lock/override/adaptive controls.
- Transparent bounded adaptation with reason logging.
- Student goals and personal progress.
- Badge criteria and server-authoritative awards.
- Cooperative classroom milestones.
- Teacher reports and aggregate administrator reports.
- PIN-student parity.
- Admin/Super Admin granular/full resets with immutable audit.

### Exit gate

- All reports enforce role and tenant boundaries.
- Rewards cannot be forged or duplicated.
- Adaptation is visible, explainable, reversible, and teacher-bounded.
- Reflections and sensitive data are not present in general analytics.

## Phase 7 — Phase 1 Catalog, Wave A

### Goal

Complete the remaining Discover and Explore flagship experiences and migrate selected legacy games.

### Games

- Word Builder
- Number Garden
- Feelings Detective
- Fraction Kitchen
- Choice Quest
- Memory Lab
- Sequence Lab
- Pattern Lab

### Supporting work

- Foundational literacy audio library
- Discover object/character/environment assets
- Explore maps/kitchen/mystery assets
- Deeper match/sequence/pattern engine variants
- Content QA across multiple levels

### Exit gate

- Discover can be used before independent reading.
- Explore supports growing independence without childish presentation.
- Each experience has sufficient content depth to avoid rapid repetition.
- Legacy progress is preserved or transparently migrated.

## Phase 8 — Phase 1 Catalog, Wave B

### Goal

Complete remaining Challenge and Advance flagship experiences and legacy migration.

### Games

- Headline
- Money Moves
- Critical Read
- Focus Lab
- Reaction Challenge
- Math mechanic migration/continuity

### Supporting work

- Media/source-review workflow for Headline and Critical Read
- Financial simulation rules and disclaimers
- Challenge and Advance avatar/profile assets
- Mature reward presentation
- Attention/reaction accessibility alternatives and construct review

### Exit gate

- Approximately 18 playable experiences are available: 12 flagship experiences plus six preserved/evolved legacy experiences or their verified successor mechanics.
- All four bands and five domains are represented across the catalog.
- All Phase 1 experiences meet the instructional definition of done.

## Phase 9 — Content Administration and Scaled Authoring

### Goal

Reduce dependence on engineering for content expansion while strengthening governance.

### Work

- Admin content editor for prompts, passages, scenarios, choices, rubrics, hints, explanations, mappings, graphics, audio, and alternatives.
- Preview by band, role, device, and accessibility setting.
- Review comments, approval, scheduled publication, retirement, rollback, and change log.
- Bulk import/export with validation.
- Duplicate/content-overlap detection.
- Content health dashboard: missing alt text, missing audio transcript, expired source, unresolved review, low-performing item, possible bias flags.

### Exit gate

- Approved content staff can publish a new content pack for an existing engine without code deployment.
- Production publication is permissioned and auditable.
- Invalid or incomplete packs cannot publish.

## Phase 10 — Phase 2 Curriculum Expansion

### Goal

Expand depth and breadth after the platform proves stable.

### Planned additions

- Rhyme Time
- Story Steps
- Math Quest
- Vocabulary Voyage
- Logic Explorer
- Digital Choices
- Wordcraft
- Ratio Rally
- Digital Dilemmas
- Build Your Week
- Argument Lab
- Data Decisions
- Communication Lab
- Life Balance Simulator

### Selection criteria

Prioritize based on:

- Teacher demand
- Skill-graph gaps
- Ability to reuse existing engines
- Content readiness
- Accessibility feasibility
- Cross-domain differentiation
- Evidence from Phase 1 pilots

### Exit gate

- New experiences are mostly content/configuration work on existing engines.
- Engineering effort is concentrated on genuinely new mechanics rather than duplicated game scaffolding.

## Phase 11 — District/Enterprise Readiness and Interoperability

### Goal

Prepare for broader school/district deployment without destabilizing the core.

### Candidate work, subject to customer requirements

- District hierarchy and aggregated reporting
- Standards crosswalk expansion
- Roster/classroom interoperability
- SSO and automated provisioning where approved
- Export formats and district data agreements
- Configurable retention by contract/policy
- Operational dashboards, support tooling, and incident response
- Accessibility conformance documentation
- Security/privacy review packages
- Load/performance scaling

Do not implement a generic integration merely because it is common in education. Validate actual customer and hosting needs first.

### Exit gate

- District requirements have explicit contracts and tests.
- Tenant isolation, privacy, performance, support, and data lifecycle are proven at intended scale.

## Phase 12 — Evidence, Validation, and Continuous Improvement

### Goal

Build a defensible evidence base and improve learning experiences without overstating results.

### Stages

1. **Usability:** Can students and teachers use the experience successfully?
2. **Content validity:** Do qualified reviewers agree the activities represent the intended skills?
3. **Implementation quality:** Are assignments, dosage, supports, and classroom use occurring as designed?
4. **Reliability/measurement research:** Only if FNE intends to make assessment claims.
5. **Outcome evaluation:** Use appropriate research design before claiming academic or SEL impact.

### Data principles

- Predefine questions and metrics.
- Use aggregated/de-identified data where possible.
- Separate product analytics from research datasets.
- Obtain required school/parent/IRB/legal approvals for research.
- Publish limitations and avoid causal claims from engagement correlations.

### Exit gate

- Product claims match the level of evidence actually established.
- Content and algorithms have documented review and change histories.

## Phase 13 — Long-Term K–12 Platform End State

### Goal

Operate Tune Your Brain as a connected, governed, scalable K–12 experience.

### End-state capabilities

- Broad skill graph across all five domains
- Multiple standards frameworks
- District curriculum tags
- Rich, reviewed content library
- Reusable engine marketplace internal to FNE
- Mature content operations
- Age-respectful progression across bands
- Preserved lifelong FNE achievement history within school governance
- Teacher-directed and bounded adaptive pathways
- Robust accessibility and localization readiness
- Evidence-informed content improvement
- Clear version history for skills, content, engines, and reports

---

# 16. Definition of Done

A game or experience is not done until all applicable items pass.

## Instructional

- Learning objective and primary skill are explicit.
- Prerequisites and difficulty are defined.
- Modeling, practice, feedback, retry, and closure are present.
- Evidence distinguishes independent and supported responses.
- Transfer/reflection is included when appropriate.
- Content depth is sufficient to avoid trivial memorization.

## SEL/developmental

- Band language, choices, emotional intensity, and executive load are appropriate.
- Scenario does not moralize identity, poverty, disability, family structure, culture, or emotion.
- Multiple responsible answers are supported when warranted.
- No diagnosis or inference from simulated choices.
- Sensitive content and help-seeking are handled correctly.

## Product/UX

- Works within the correct experience shell.
- Has clear start, pause, resume, exit, and natural stopping point.
- Provides age-respectful feedback and reward presentation.
- Responsive on approved devices/sizes.

## Accessibility

- Keyboard/touch/mouse supported.
- Focus order and status announcements work.
- Captions/transcripts/alternatives exist.
- Reduced motion works.
- Non-drag alternative works.
- Color/audio/timing are not sole means unless the construct requires them and an equivalent accommodation is provided.
- Manual accessibility review supplements automated testing.

## Data/privacy/security

- Server-side authorization and tenant isolation verified.
- Data collection is minimized and classified.
- No unnecessary PII or sensitive text in telemetry/logs.
- Rewards and completion are server-authoritative/idempotent.
- Content and engine versions are recorded.
- Reset/support operations are audited.

## Quality

- Unit, integration, contract, end-to-end, accessibility, responsive, and regression tests pass.
- Existing FNE workflows remain intact.
- Migrations and rollback are tested.
- No unresolved critical/high defects.
- Traceability and handoff documents are current.

---

# 17. Testing Strategy

## 17.1 Automated layers

- Schema and content validation tests
- Engine lifecycle unit tests
- Scoring/rubric tests
- Adaptation-boundary tests
- Reward idempotency tests
- Permission/tenant-isolation tests
- API contract tests
- Migration/backfill/rollback tests
- Component accessibility tests
- End-to-end role flows
- Visual regression by band and breakpoint
- Performance/load tests for session/event writes

## 17.2 Required end-to-end personas

- Discover classroom-PIN student
- Explore classroom-PIN student
- Challenge student
- Advance student
- Teacher with one classroom
- Teacher with multiple classrooms/groups
- Primary school admin
- Secondary school admin
- Read-only school admin
- School Safety Admin where relevant
- FNE Admin
- FNE Super Admin

## 17.3 Manual instructional QA

Automated tests cannot judge instructional quality. Human review must inspect:

- Whether the prompt measures the stated skill
- Whether distractors reflect plausible misconceptions
- Whether feedback teaches rather than merely reveals
- Whether scenarios respect context and culture
- Whether age presentation feels respectful
- Whether audio is instructionally accurate
- Whether alternative interactions preserve the construct
- Whether the game has an appropriate stopping point

## 17.4 Pilot QA

Pilot with small, permissioned cohorts before broad release. Observe:

- Comprehension of instructions
- Navigation failures
- Hint behavior
- Accidental taps/drag difficulty
- Content ambiguity
- Emotional response and perceived fairness
- Teacher interpretation burden
- Session length and classroom fit

Use observation and feedback to improve the product; do not turn pilot engagement into unsupported efficacy claims.

---

# 18. Operational Metrics and Product Health

## Healthy operational metrics

- Assignment launch and completion
- Completion with/without support
- Retry and hint patterns
- Item ambiguity/skip rates
- Teacher assignment reuse
- Time to first successful play
- Accessibility-feature success/failure
- Resume reliability
- Content error reports
- Technical errors/latency
- Domain/catalog coverage
- Content review aging

## Metrics requiring caution

- Time on platform is not inherently positive.
- More attempts can mean persistence or confusion.
- Fast response can mean fluency or guessing.
- A chosen SEL option does not prove real-world behavior.
- Badge counts do not equal learning.
- Engagement trends do not establish outcomes.

The product should optimize for meaningful, successful practice and classroom usefulness, not maximum screen time.

---

# 19. Content Governance and Review Roles

At scale, each content release should include the applicable reviews:

- Curriculum/subject-matter review
- SEL/developmental review
- FNE Issues-to-Answers fidelity review
- Accessibility/UDL review
- Cultural/identity/bias review
- Student-safety review
- Privacy/data review
- Copy editing
- Audio/phonics review
- Technical validation
- Final publishing approval

No single reviewer needs every specialty, but the workflow must show which reviews were required and completed.

## Content lifecycle

```text
Draft → Internal Review → Revision → Approved → Scheduled/Published
      → Corrected Version or Retired → Archived for historical traceability
```

Published content should not be edited in place when the change could affect meaning, scoring, or evidence. Create a new version.

---

# 20. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Building many one-off games | Enforce engine/content separation and phase gates |
| Childish presentation for older struggling learners | Separate experience band from skill level |
| Gamification overwhelms learning | Meaningful achievement criteria, natural stops, no public ranking |
| SEL becomes moralistic trivia | Multiple defensible responses, context, impact feedback, reflection |
| Unsupported assessment claims | Evidence discipline and claim review |
| Teacher data overload | Actionable summaries; distinguish completion, support, and evidence |
| Admin access exposes student details | Aggregate reporting and server-side role enforcement |
| PIN students remain second-class | Resolve identity/progression linkage in Phase 1 foundation |
| Audio phonics errors | Professionally controlled assets and specialist review |
| Accessibility bolted on late | Shared accessible engine patterns before catalog scale |
| Content changes invalidate history | Version everything presented/scored |
| Cross-tenant leakage | Central tenant scope, authorization tests, negative tests |
| Client score/reward manipulation | Server-authoritative validated events and idempotency |
| Excessive telemetry | Event allowlist, classification, retention, no sensitive free text |
| Frozen redesign accidentally revived | Protect active design; document frozen files |
| Claude loses project context | Required memory files and phase handoffs |

---

# 21. Claude Code Work Protocol for Every Phase

For each phase, Claude Code must follow this exact rhythm:

## A. Orient

- Read project memory and latest handoff.
- Check git status and preserve unrelated work.
- State the approved phase and boundaries.

## B. Inspect

- Locate all affected files, routes, services, tables, tests, and callers.
- Trace current behavior end to end.
- Identify protected dependencies and rollback needs.

## C. Plan

- Produce a bounded implementation plan.
- List migrations, APIs, UI, tests, data impact, risks, and acceptance criteria.
- Identify unresolved decisions before code.

## D. Implement

- Make small, coherent changes.
- Prefer shared components/services.
- Use additive migrations and feature flags.
- Keep content configuration separate from engine logic.

## E. Validate

- Run focused tests during work.
- Run build/lint/type checks and the applicable full suite before completion.
- Exercise every affected role and tenant boundary.
- Perform responsive and accessibility checks.

## F. Review

- Inspect diffs for accidental deletions, scope creep, PII/logging, permission gaps, and duplicated architecture.
- Compare implementation against acceptance criteria and traceability.

## G. Checkpoint

- Commit or create the repository's approved checkpoint.
- Update `PHASE_STATUS.md`, `TRACEABILITY.md`, `DECISIONS.md`, `TEST_MATRIX.md`, and `SESSION_HANDOFF.md`.
- Record exact next step and blockers.

Claude Code must stop at the phase boundary and report results. It must not automatically roll into the next phase.

---

# 22. Initial Claude Code Kickoff Prompt

Use this prompt with the repository and this blueprint:

> You are beginning the Fixer Nation Education Tune Your Brain workstream. Read the repository's `CLAUDE.md`, `PROJECT.md`, all relevant specifications, and `docs/tune-your-brain/MASTER_PLAN.md` before making changes. The master plan describes the complete K–12 end state, but you are authorized only for Phase 0: Repository Forensics and Baseline. Do not implement product changes in this phase.
>
> Inspect the current application, routes, Node/runtime stack, schema and migrations, authentication, school/classroom tenancy, classroom-code/username/PIN student flow, teacher/student/admin portals, existing Brain Games, XP/levels/badges/streaks, assignments, progress, notifications, analytics, content administration, reset/audit behavior, design tokens/assets, frozen redesign files, test coverage, deployment commands, and known failures.
>
> Preserve all existing functionality and unrelated work. Do not assume remembered architecture is still accurate; verify it from the repository and running application. Do not create parallel services or write migrations.
>
> Produce the Phase 0 deliverables defined in the master plan: current-state document, route/role matrix, schema map, architecture/data-flow diagram, do-not-break inventory, baseline test results, gap/risk register, and proposed file impact for Phase 1. Update the project-memory files and end with a concise handoff. Stop after Phase 0 and request approval before implementation.

---

# 23. Immediate Leadership Decisions Deferred Until Repository Discovery

Claude Code should not guess these before Phase 0:

- Exact existing database/table names and migration tooling
- Whether current rewards can be extended cleanly or require an adapter
- Whether existing assignments can represent games/skills directly
- Where the content authoring workflow currently lives
- Which event/analytics service is authoritative
- Whether current hosting limits affect audio/media delivery or event volume
- Which current games can be wrapped by the engine SDK versus progressively replaced
- Whether CI can be enabled immediately or requires hosting/repository changes
- Exact retention windows for each new game-data class
- Whether standards mappings ship in Phase 1 or remain pilot-only content

These are discovery outputs, not reasons to weaken the end-state architecture.

---

# 24. Reference Frameworks

This blueprint uses the following authoritative frameworks as design inputs, not endorsements:

- CASEL SEL framework and evidence-based-program guidance: https://casel.org/ and https://schoolguide.casel.org/
- CAST Universal Design for Learning Guidelines 3.0: https://udlguidelines.cast.org/
- W3C Web Content Accessibility Guidelines 2.2: https://www.w3.org/TR/WCAG22/
- U.S. Department of Education Student Privacy resources: https://studentprivacy.ed.gov/
- Federal Trade Commission COPPA resources and 2025 rule amendments: https://www.ftc.gov/business-guidance/privacy-security/childrens-privacy

Legal, contractual, accessibility, curriculum, and research claims require appropriate qualified review before production release.

---

# 25. Final Product Standard

Tune Your Brain succeeds when a student experiences a respectful, enjoyable challenge; a teacher can see what was practiced and what support was needed; a school can understand adoption without unnecessary student exposure; content leaders can grow the library safely; and engineering can add new experiences primarily through governed content and reusable engines.

The platform should leave the learner with a credible sense of:

> **I practiced something meaningful. I understand my next step. I can try again.**

That is the standard against which every phase, game, reward, report, and design decision should be judged.
