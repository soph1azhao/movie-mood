# Movie Mood — Project Retrospective

**Status:** V8.2 release candidate complete; `v8.2.0` release pending
**Repository:** `soph1azhao/movie-mood`
**Primary local repo:** `/Users/hermes/code/movie-mood`
**Runtime architecture:** static Vite + React + TypeScript + plain CSS on GitHub Pages; no backend, accounts, database, or runtime authenticated TMDB API.

This document is long-term project memory. It is meant for three audiences at once:

1. the maintainer returning after a break;
2. a new ChatGPT/Codex/other agent joining the project with no chat context;
3. a beginner developer trying to understand not only what was built, but why certain engineering habits became permanent.

Two sentences define the project better than any feature list:

> **Streaming platforms help you find more movies. Movie Mood helps you choose one.**

> **Movie Mood owns meaning. TMDB owns facts.**

The project began as a first vibe-coding experiment: choose a mood and receive three films. By V8.1 it had become both a working decision product and a disciplined AI-assisted engineering workflow. The most important achievement is not code volume. It is learning how to turn fast model output into a product that remains understandable, testable, reviewable, reversible, and intentionally simple.

## Project at a glance

| Version | Main question |
| --- | --- |
| V1 — Mood | What do I feel like watching? |
| V2 — Context | What fits tonight? |
| V3 — Discovery | How adventurous / demanding should the choice be? |
| V4 — Decide | How do I stop browsing and actually choose? |
| V5 — Real Movies | How do real TMDB identities/facts enter without taking over product meaning? |
| V5.1 — Curation & Closure | How can the catalogue be maintained safely? |
| V5.2 — Progressive Reveal | How can the product know more while asking less? |
| V6 — Selective Decision Companion | When three good options remain, when should Movie Mood intervene? |
| V7.1/V7.2 — Match the Moment / Earned Atmosphere | Can visual hierarchy and atmosphere support the decision state better? |
| V8 — Cinematic Identity | Can the product feel unmistakably cinematic without adding new decision logic? |
| V8.1 — Catalogue Scaling & Production Pipeline | Can semantic catalogue production scale reproducibly, resumably, and safely? |

### A few terms used throughout

- **Product semantics**: the meaning of moods, situations, attention, pace, emotional weight, decision rules, and other Movie Mood editorial logic.
- **Presentation**: layout, visual hierarchy, copy, motion, atmosphere, and how those semantics appear to a person.
- **Artifact**: a saved output plus enough identity/provenance to know exactly how it was produced.
- **Manifest**: a durable ledger of candidates, attempts, state transitions, budgets, and identities for a batch/run.
- **Provenance**: information that lets us answer “where did this value/output come from?”
- **Fail closed**: when identity, transport state, or semantic validity is uncertain, stop rather than guess or silently accept.
- **Idempotent**: safely running the same recovery/action again does not duplicate or corrupt prior work.
- **Preflight**: a zero-call/read-only inspection that proves the next live action is safe before external API work begins.

## 1. Pitfalls we encountered: lessons worth keeping

The project did not mainly suffer from “bad code.” Most of the expensive mistakes came from **workflow design, premature assumptions, context management, and confusing technical correctness with product correctness**.

| Pattern                                                                    | What happened                                                                                                                                                                                                             | Why it cost us                                                                                               | Permanent lesson                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Repeated huge prompts**                                                  | During V2 we repeatedly told Codex which docs to read, which commands to run, how to verify, when to commit, when to push, etc.                                                                                           | Large context, repeated tokens, unnecessary human turns, more opportunities for conflicting instructions.    | Stable operating rules belong in `AGENTS.md`; version details belong in one spec; normal task prompts should be tiny. This was one of the main V2→V3 workflow corrections.                                                        |
| **Too many implementation round-trips**                                    | “Implement Phase X” → review → “commit” → “push” → “verify” often became separate interactions.                                                                                                                           | The human became an orchestration layer for routine mechanics.                                               | By V4 we moved toward `Execute V<N> Phase X`: implement → test → inspect → commit → push → verify, unless a genuine blocker exists.                                                                                               |
| **Wrong repository / stale checkout**                                      | More than once an agent landed in `/Users/hermes/Documents/ChatGPT/movie-mood` instead of `/Users/hermes/code/movie-mood`. One stale checkout even contained a drastically outdated README.                               | Extremely dangerous: correct-looking work could be done against the wrong project state.                     | Repository path + remote verification must happen at session start. `AGENTS.md` became the repository-level guardrail rather than relying on chat memory.                                                                         |
| **Too much active historical context**                                     | Old V2/V3/V4 plans, duplicated files, old implementation prompts and stale assumptions remained available long after being superseded.                                                                                    | Models can anchor on outdated instructions and we spend tokens reconstructing which source is authoritative. | Keep current normative specs active; consolidate history into one retrospective; archive rather than feed obsolete planning into every new discussion.                                                                            |
| **Treating free-agent cost savings as a correctness strategy**             | We experimented with Hermes/Poolside for V4. Laguna could implement bounded work, but XS repeatedly hit provider 429s, used invalid tool-call patterns, and context grew from ~7k to ~42k without a verified correction.  | Retrying an unreliable provider consumed more attention than the savings justified.                          | Route by risk: cheap/free agents for bounded work; stronger coding agent for subtle state, URL, debugging and release-critical work. Escalate early when the failure is infrastructure, not reasoning.                            |
| **Asking one model to judge its own work**                                 | Early workflow leaned heavily on implementation-agent self-report: tests passed, build passed, therefore phase looked done.                                                                                               | Self-verification misses conceptual and integration errors.                                                  | High-risk releases deserve an independent acceptance pass. V5.1 confirmed the value of Hermes/free for bounded implementation and Codex for release authority.                                                                    |
| **Testing came too late in the project's evolution**                       | Early versions depended more on manual reasoning/build checks. Reusable filtering, discovery, cycling, decision and URL logic gradually acquired tests later.                                                             | The same edge cases had to be reasoned about repeatedly.                                                     | If logic is deterministic, reusable and has meaningful edge cases, encode the invariant once as a test. By V3 onward this became a major efficiency gain.                                                                         |
| **Deployment configuration looked simple until it wasn't**                 | GitHub Pages initially failed because `setup-node` tried to use the pnpm cache before pnpm had been installed.                                                                                                            | Small CI sequencing mistake caused multiple deployment cycles.                                               | Treat CI as code: dependency/tool setup order matters; once fixed and verified, don't casually rewrite stable deployment infrastructure.                                                                                          |
| **Secrets were handled too casually at first**                             | TMDB token use via shell led to concern about command history; the token was regenerated and history cleaned.                                                                                                             | Credential hygiene became a distraction after otherwise successful V5 work.                                  | Secrets live in process environment only; never prompts, frontend env, repository or logs. Credential hygiene is designed before API work, not cleaned up afterward.                                                              |
| **External-data assumptions were too strict**                              | During catalogue work, `posterPath: null` exposed a mismatch between TMDB's legitimate nullable data and our snapshot validation/conventions.                                                                             | A valid external record looked like a project failure.                                                       | Model external APIs according to their real contracts. Optional presentation data should degrade gracefully; hard behavioral data should fail validation. This later became explicit in the curation guide.                       |
| **“Facts” were assumed to be presentation-only**                           | In V5 we discovered TMDB runtime, genre and language are not merely display metadata—they already affect filters, dealbreakers and similarity.                                                                            | A factual refresh could silently change product behavior.                                                    | Classify data by behavioral impact. Snapshot external facts, review diffs, preserve stable local IDs, and make synchronization atomic and human-reviewable.                                                                       |
| **Over-scoping attractive ideas**                                          | Search, multiplayer, ratings, larger catalogues, new experience dimensions, streaming APIs and other possibilities repeatedly appeared in brainstorming.                                                                  | Attractive features can dilute “stop browsing and choose.”                                                   | A feature needs a demonstrated current-scale problem. The post-V5.2 review explicitly rejected search and postponed Together mode despite their conceptual appeal.                                                                |
| **Exposing the data model as UX**                                          | Earlier interfaces surfaced things like pace, emotional weight, attention demand and discovery style too directly.                                                                                                        | The product began feeling like a configuration dashboard rather than a movie decision companion.             | “Movie Mood should know more than it asks.” Use progressive disclosure and human presentation copy; internal taxonomy should not leak into the interface simply because it exists in TypeScript.                                  |
| **Assuming a detectable distinction is a useful distinction**              | V6's feasibility work showed many clean 2:1 metadata splits. We then implicitly treated “clean split exists” as “useful decision question exists.”                                                                        | Technical feasibility was mistaken for psychological usefulness.                                             | Structural evidence and decision relevance are different questions. Validate the interaction with real slates/human judgment before encoding it as product logic.                                                                 |
| **Trying to fix a structural UX problem with better copy**                 | V6's adaptive questions initially felt like filters. We rewrote them into friendlier wording, but human testing still found them artificial.                                                                              | We spent iterations polishing symptoms rather than revisiting the cognitive task.                            | If repeated copy changes don't alter the user's feeling, examine the interaction model. Recognition can be the real need when abstract self-report fails.                                                                         |
| **The V6 symmetric 2:1 logic contained a hidden arbitrary decision**       | For majority pair A+B and outlier C, one branch correctly kept A+B; the other kept C plus whichever majority movie happened to come first and silently eliminated the other.                                              | The UI claimed transparent narrowing while array order was doing hidden decision work.                       | Every eliminated item needs an explicit, user-legible reason. Never let deterministic implementation order masquerade as product reasoning. The mapping analysis proved the split is pair-vs-singleton, not two symmetric pairs.  |
| **Three-film and two-film information roles got mixed**                    | Three-slate cards temporarily displayed pairwise sentences such as a statement about Paddington under Wilderpeople.                                                                                                       | Cards stopped answering “what is this movie like?” and duplicated comparison copy.                           | Define information roles: three-card stage describes each movie; companion surfaces a relevant distinction; Duel compares finalists.                                                                                              |
| **Technical PASS was sometimes mistaken for product PASS**                 | V6 reached passing tests/build/browser checks, yet direct human use still felt unnatural.                                                                                                                                 | Automated acceptance cannot detect whether an interaction feels contrived.                                   | Maintain two acceptance gates: **technical correctness** and **human/product acceptance**. V6 is the strongest lesson: stopping a technically functional feature before release is success, not failure.                          |
| **We sometimes implemented before doing the cheapest possible validation** | V6's state plumbing existed before we had manually tested whether the 2:1 question model was actually helpful.                                                                                                            | Sunk cost made later redesign emotionally and technically harder.                                            | For new interaction models: prototype examples → test real catalogue cases → inspect pattern → then write the state machine.                                                                                                      |
| **Treating correlated metadata as independent confirmation** | V6 briefly used “2-of-3” agreement across attention, emotional weight and pace as evidence that an outlier was meaningful. Catalogue analysis showed `attentionDemand` and `emotionalWeight` were strongly associated rather than independent signals. | Apparent multi-dimensional agreement could simply count the same underlying editorial judgment twice. | Do not interpret multiple metadata fields as independent evidence without checking their relationship. Correlation analysis can invalidate a product heuristic even when the code is perfectly deterministic. |
| **Letting weak evidence veto strong evidence** | An early coherence rule examined every clean split before checking whether the split was actually salient. A weak adjacent difference could therefore suppress a genuinely useful strong distinction pointing to another movie. | Noise gained decision authority it had not earned. | Apply **salience before coherence**. Evidence too weak to trigger an intervention must also be too weak to veto one. |
| **Visual changes were technically valid but perceptually too weak** | V7.2 passed tests, build, deployment and independent review, yet the user still experienced the release as “too subtle.” | Engineering conservatism had become visual conservatism; a version could be different in source code but barely distinguishable in use. | Add a **perceptual acceptance gate**. For a visual version, ask whether a screenshot, transition, hierarchy and emotional state are obviously different. **Preserve semantics does not mean preserve layout.** |
| **Source-level responsive reasoning missed runtime CSS behavior** | A V7.2 audit found a mobile CSS specificity/cascade issue even though the intended media-query rule existed in source. | Reading CSS rules is not equivalent to knowing which computed rule wins in the browser. | For responsive/layout work, inspect the rendered/computed result at representative breakpoints. A media query's presence is not proof that it controls runtime layout. |
| **Premature specification before visual composition was mature** | During the visual evolution toward V8, it was tempting to convert a broad direction directly into an implementation spec. Early demos could satisfy abstract requirements yet still look generic or unlike the real site. | Implementation detail hardened before the perceptual target was understood, creating micro-fixes instead of a coherent visual change. | For major visual work use: **experiential thesis → references/exploration → composition mockups → choose direction → technical feasibility → implementation spec → code.** |
| **Generic AI visual language leaked into exploration** | Some V8 explorations had obvious AI-generated UI tendencies: blue/purple gradients, generic equal-card grids, large radii/shadows, decorative iconography, hover enlargement, or hero-section patterns. | They could look polished while feeling unrelated to Movie Mood's restrained editorial/cinematic identity. | Reject style tropes explicitly. Visual exploration must be judged against the actual product, not against generic “modern UI” polish. |
| **Mockups drifted from the real site's composition** | A3 / warm cinematic directions were promising, but some demos still behaved like standalone concept pages rather than Movie Mood screens. | A visually attractive concept can fail if it cannot map onto the existing user flow, card proportions, reveal stages, and mobile composition. | Mockups must preserve **flow fidelity** even when layout changes substantially. Before coding, describe both desktop and mobile composition in terms of the actual screens. |
| **Repeated independent audits can become ceremonial** | As the project matured, there was a temptation to ask another model to re-audit an already frozen, validated decision simply because more rigor felt safer. | Review consumes time/tokens and can reopen settled questions without new evidence. | Independent review is valuable at decision boundaries. After a protocol or design is frozen and the blocker is fixed, prefer a **focused recheck**, not another full audit. Stop weaponizing rigor against hypothetical risks. |
| **Provider availability was initially confused with model capability** | Gemini 3.7 Flash repeatedly returned 503/high-demand failures; a later smoke also produced provider failures and malformed output. | Retrying an unavailable provider can waste time while producing no evidence about intrinsic semantic quality. | Separate **transport/provider availability** from **semantic quality**. Bound retries, record the operational result, and move on. A 503 is not a reasoning benchmark. |
| **A fragile external source became a critical path** | The V8.1/C1b confirmatory path depended on Wikipedia evidence and was ultimately blocked by 429s. | A third-party operational limit could stall an otherwise valid internal evaluation program. | External evidence dependencies need a termination rule and should not become irreplaceable critical paths unless necessary. When a preregistered protocol is operationally inconclusive, close it; do not retrofit the question until it “passes.” |
| **We almost over-generalized rare structured-output failures** | At Semantic-200 and Semantic-400, model responses contained stable semantic choices but malformed evidence containers. | A tempting response was to add global silent normalization after the first incident. That could hide genuinely malformed future output. | Preserve raw output, diagnose offline, use candidate-bound deterministic repair, run the existing strict validator, and keep future malformed responses fail-closed until evidence justifies a general rule. |
| **“Retry harder” would have been the wrong response to semantic structure failures** | Low, High and Max could all understand the movie yet serialize evidence incorrectly. Blindly issuing another Max call would spend quota without addressing the actual failure mode. | More reasoning effort is not a universal fix for schema/serialization defects. | Inspect the failed artifact first. Distinguish semantic reasoning failure from structural serialization failure before spending another model call. |
| **Token/accounting semantics were easy to misread** | Kimi reported `thinking_tokens` as detail within completion accounting; membership quota behavior was not published as a simple token multiplier. | Double-counting thinking or claiming exact quota savings would produce false cost conclusions. | Understand each provider's usage schema before calculating totals. Report provider `total_tokens` as observed metadata; do not equate it with opaque membership quota units. |
| **A numeric target can become fake progress** | V8.1 had infrastructure for 500 and ambitions toward 1,000+, but by 400 cumulative semantic records the engineering question was already answered. | Chasing a round number would consume API quota and time while adding little new learning. | Define a **stopping rule**. A milestone is complete when its uncertainty is resolved, not when an arbitrary count looks impressive. Semantic-500 was intentionally not pursued. |
| **Live batch state can be misread if snapshots and results are conflated** | Scale-500 orchestration reports included an initial preflight snapshot plus later live results; the initial `readyCount` could look stale after a successful tranche. | Misreading state could trigger unnecessary reruns or distrust of correct resumability. | Know which fields are snapshots, cumulative state, current invocation accounting, and final results. Never rerun an authorized batch merely because stdout looks quiet or an initial snapshot is stale. |
| **Terminal use itself can create avoidable risk for beginners** | On at least one occasion, explanatory prose was pasted into `zsh`, producing shell errors even though the repo was unharmed. API-key/history cleanup also became more complex than necessary. | The user had to distinguish shell syntax from explanation while already handling unfamiliar tooling. | Command blocks must contain commands only. Prefer short, copy-safe commands, explain expected output separately, and never ask a user to paste secrets into chat. |

The recurring meta-pattern is:

> **Whenever we let implementation convenience become product logic, we got into trouble.**

Array order chose a survivor. Metadata availability chose a question. An enum became UI copy. A provider price influenced task routing. A test pass looked like product approval.

The project became much stronger whenever we reversed that direction:

> **Human problem → explicit product rule → simple architecture → automated invariant → implementation.**

---

# 2. The positive story: how Movie Mood actually grew

I would preserve the history because it is a very good first-project story.

This was not “one prompt generated an app.”

It was almost the opposite.

Movie Mood started with an extremely small question:

> **What should I watch tonight?**

The first version did almost nothing: choose a mood and get three movies.

That constraint was useful. Instead of immediately building accounts, recommendation AI, search, a huge catalogue or a backend, the project kept asking one question after each working version:

> **What is the next real source of friction?**

That produced a remarkably coherent version history.

**V1 — Mood** established the idea: a person's current feeling is a better starting point than an infinite movie catalogue.

**V2 — Context** learned that mood alone isn't enough. Tonight may be a date, a tired evening, a family watch, or a short window. We added situations, practical filters, richer cards, details, cycling, favorites and My List—but deliberately stayed static and browser-local.

The implementation process itself also matured here. V2 exposed how inefficient our early AI workflow was: enormous repeated prompts, separate verification/commit/push conversations, and too much reliance on chat memory. That led directly to the `AGENTS.md` + version specification + short phase-prompt model that became the project's engineering backbone.

**V3 — Discovery** added something more subtle: not just factual filtering, but how much attention the viewer has, how adventurous they want to be, and what is explicitly “not tonight.” Dealbreakers became hard constraints; softer preferences remained ordering signals. “More like this” stayed deterministic and local rather than pretending to be an intelligent personalization engine. The version also introduced meaningful automated test coverage for reusable recommendation logic.

**V4 — Decide** recognized an important product truth: recommendations are useless if the user still cannot choose. Movie Mood moved from browsing support to decision support—Decision Mode, a duel between finalists, contextual deciding factors, a playful coin-flip gut check, Tonight's Pick, Change My Mind, and restorable URL state. The version preserved the static architecture even as the state machine became substantially richer.

V4 also became our experiment in multi-agent development. We tried to reduce cost through Hermes and free provider models. Some bounded work went well; provider reliability and high-risk debugging did not. Instead of pretending one agent was universally best, the workflow evolved toward **task routing by risk**: cheaper agents where mistakes are cheap, stronger coding models where state integrity or release correctness matters.

**V5 — Real Movies** could easily have destroyed the architecture. The obvious move would have been runtime TMDB requests from the browser. We chose a more disciplined solution: manually verified TMDB identities, maintainer-time synchronization, a committed factual snapshot, stable Movie Mood local IDs, and no runtime authenticated TMDB data dependency.

That version produced one of the project's best architectural sentences:

> **Movie Mood owns meaning. TMDB owns facts.**

Movie Mood keeps moods, situations, emotional weight, attention, discovery meaning and editorial copy. TMDB supplies factual identity, runtime, genres, languages, countries, director and poster path. Even there, we learned that “facts” can influence product behavior, so factual changes became versioned and reviewable rather than silently remote.

**V5.1 — Curation & Closure** asked how to maintain the product rather than simply add another feature. The curation assistant searches TMDB and scaffolds a movie, but explicitly refuses to invent Movie Mood's meaning. Human curation remains authoritative. Poster behavior became resilient, and Tonight's Pick gained an honest handoff toward finding where to watch.

Then we did something that many first projects skip: **we tested the maintenance workflow itself**.

Catalogue Trial A added five deliberately chosen films. That exercise exposed real edge cases such as nullable posters and gave us a permanent curation workflow based on actual repository behavior rather than hypothetical documentation. The trial proved the complete chain:

> curate → verify identity → sync facts → test → build → deploy → inspect live product.

That is a far more mature outcome than merely having more titles.

**V5.2** then turned inward and simplified the experience. The project had accumulated a rich internal model, but users should not have to operate that model manually. Progressive disclosure, Glimpse → Reveal, human-facing copy and easier elimination reflected a new principle:

> **Keep the rich model. Hide most of it.**

The post-V5.2 review found that the Duel and Tonight's Pick were already strong, while the remaining meaningful friction was the three-to-two transition.

And then came the most valuable failure—and eventually one of the strongest successes—in the project:

**V6 — Selective Decision Companion.**

The post-V5.2 review showed that the Duel and Tonight's Pick were already working well. The remaining friction was narrower:

> **How do we help a user move naturally from three good movies to two?**

The first V6 hypothesis was an adaptive binary question.

The feasibility audit looked promising. Clean 2:1 metadata splits appeared frequently across real reachable slates, and the implementation could deterministically generate questions from attention demand, pace, emotional weight and runtime.

Technically, it worked.

Tests passed. The build passed. The browser flow worked.

But human use said:

> **This doesn't feel natural.**

The questions felt like filters rewritten in friendlier language. The user was still being asked to formulate an abstract preference—“slower or faster?”, “lighter or heavier?”—at exactly the moment Movie Mood was supposed to reduce cognitive work.

Instead of polishing the wording indefinitely, we stopped and questioned the mechanism itself.

That exposed an even deeper problem.

For a slate containing majority pair A+B and outlier C, choosing the majority correctly preserved A+B. But the opposite answer could not logically produce a unique pair: the implementation kept C plus whichever of A or B happened to appear first.

Array order was silently making a product decision.

That permanently killed the symmetric two-answer model.

The product question changed from:

> **Which abstract preference do you want?**

to:

> **Is one specific movie different enough that it is useful to point that out?**

That produced **Form B**:

```text
Decision companion

[Movie] stands a little apart.

[neutral observation]

[vibeSummary]

[ Not tonight ]    [ Keep it in ]
```

The semantics became deliberately asymmetric and transparent:

* **Not tonight** removes only the highlighted movie and sends the untouched remaining pair into Duel.
* **Keep it in** removes nothing and returns control to the normal three-film decision flow.
* If Movie Mood cannot justify highlighting one coherent movie, it stays silent.

But we did not stop there.

A second round of critique challenged the assumption that multiple metadata dimensions agreeing represented stronger independent evidence. Catalogue analysis showed that `attentionDemand` and `emotionalWeight` were strongly associated: heavy movies were overwhelmingly immersive, while light movies were almost never immersive.

The apparent “2-of-3 confirmation” was therefore often double-counting a similar editorial judgment.

So we retired convergence voting entirely.

The final V6 architecture became:

> **Raw 2:1 split → Context redundancy → Salience → Coherence**

Only three dimensions can trigger the companion:

* `emotionalWeight`: `heavy ↔ non-heavy`
* `attentionDemand`: `easy ↔ non-easy`
* `pace`: `slow ↔ fast`

Runtime can still inform ordinary movie presentation and Duel comparison, but it cannot independently trigger V6.

The order matters.

Weak differences are discarded before coherence. A small `easy ↔ engaged`-style distinction under the earlier rule could not veto a much stronger distinction on another dimension merely because it existed.

After human walkthroughs, however, we learned something subtler: the transition from a truly easy, zero-homework watch to a movie that requires active dialogue or plot tracking **was** meaningful enough to users. That evidence expanded the final attention boundary from only `easy ↔ immersive` to:

> **`easy ↔ non-easy`**

while `engaged ↔ immersive` remained below threshold.

The final rule therefore did not come from theoretical symmetry. Each metadata axis received a deliberately conservative semantic boundary based on actual Movie Mood usage.

We validated the architecture against unseen catalogue slates, conflicting-outlier cases, reverse-direction cases such as the less-heavy movie being the highlighted outlier, multiple personas, and real human walkthroughs.

Only after those product questions were settled did we freeze:

`docs/V6_IMPLEMENTATION_SPEC.md`

and return to TypeScript.

The final implementation replaced the experimental adaptive-question system with a pure deterministic `getDecisionCompanionCue` model. It preserved the entire V5.2 downstream decision flow while removing:

* symmetric adaptive answers;
* arbitrary majority survivors;
* runtime-triggered questions;
* fixed dimension priority as product logic;
* hidden scoring.

V6 shipped as:

**`v6.0.0 — Movie Mood V6`**

Release commit:

`71615b8 — Implement V6 decision companion`

Final verification included:

* 11 Vitest suites;
* 154 passing tests;
* successful production build;
* successful GitHub Pages deployment;
* six live production smoke checks;
* validated URL backward compatibility for the earlier experimental V6 decision state.

The most important result was not the feature itself.

It was the workflow that produced it.

V6 taught us that:

> **Technical feasibility is not product validity.**

> **Passing tests do not prove an interaction deserves to exist.**

> **Metadata availability does not determine what the user should be asked.**

> **Implementation order must never become hidden product reasoning.**

And perhaps most importantly:

> **Stopping a technically working feature, admitting that the model is wrong, and redesigning it from evidence is not wasted work. It is successful product development.**

V6 began as the version where Movie Mood almost shipped the wrong decision mechanism.

It ended as the version where the project proved it had learned how **not** to ship one.

---

**V7.1 / V7.2 — Match the Moment / Earned Atmosphere** shifted attention from adding decision logic to how the existing product *felt* at the moment of choosing. V7.2 strengthened Tonight's Pick hierarchy, the watch-action handoff, Duel atmosphere, and small motion/transition details. It shipped as `v7.2.0` from commit `7728eca` with 175 passing tests plus build, deployment and independent review.

But V7.2 also produced a crucial negative result:

> **The changes were real, but they were too subtle.**

That feedback revised an earlier instinct to “preserve” too much of the existing interface. We learned to distinguish three things:

- preserve **product semantics**;
- preserve **user-flow meaning**;
- do **not** automatically preserve visual composition.

A release can be semantically conservative and visually ambitious. From then on the rule became:

> **Be conservative with semantics. Be ambitious with experience.**

The V7.2 audit also caught a mobile CSS specificity issue that source inspection alone had missed. That created another permanent rule: responsive correctness must be verified in the computed/runtime layout, not inferred from a media-query declaration.

**V8 — Cinematic Identity** grew directly from that lesson. It deliberately added no new recommendation dimensions, accounts, backend, search, ratings, or AI recommendation behavior. The question was visual and experiential:

> **Can Movie Mood finally look and feel as distinctive as the decision experience it already contains?**

The process changed before the code did. Instead of writing a technical implementation specification immediately, we explored visual references, compared directions, generated mockups, rejected obvious AI-design tropes, and asked whether the composition still looked like the real Movie Mood flow.

The strongest direction was a warm, dissolving cinematic field, but early variants still taught us something: a beautiful standalone concept is not automatically a usable redesign. Some explorations felt “AI flavored” or no longer resembled the site's actual layout. We therefore made composition—not decoration—the design unit:

- backdrop-led Full Reveal rather than simply adding effects;
- editorial hierarchy rather than a metadata spec sheet;
- mood-reactive lighting inside one coherent visual universe;
- equal visual dignity for Duel finalists;
- a more earned, “lights down” Tonight's Pick state;
- explicit desktop and mobile composition before CSS implementation.

We also documented visual anti-patterns for this product: generic blue-purple gradients, decorative emoji/icon overload, three equal-width cards as a default composition, oversized corner radii, large decorative shadows, hover-to-enlarge interactions, and generic headline/subtitle/button hero sections. The point was not that these patterns are universally bad; they were wrong for Movie Mood's identity.

A Phase-0 repo check during V8 again prevented work in the wrong workspace. That incident validated the repository-verification rule rather than creating a new one: the guardrail worked because implementation stopped before modification.

V8 ultimately shipped as `v8.0.0` at commit `e2620f5`. More important than any single style was the workflow correction:

> **Do not write the implementation specification until the intended visual composition is clear enough to evaluate without code.**

**V8.1 — Catalogue Scaling & Production Pipeline** then changed domains completely. It was not a visual version. It asked whether Movie Mood's curated semantic catalogue could scale from a small set toward hundreds or eventually 1,000+ records without abandoning reproducibility, provenance, or editorial control.

The work became an offline production system rather than a runtime feature. It established:

- deterministic candidate selection;
- TMDB factual acquisition and committed evidence packets;
- strict JSON-schema semantic output;
- immutable cumulative cohorts;
- provider/model/prompt/schema/taxonomy identity binding;
- resumable manifests;
- hard candidate and HTTP budgets;
- explicit dispatch boundaries;
- fail-closed handling of unknown transport state;
- adaptive reasoning effort;
- one-command staged orchestration;
- deterministic offline recovery of structurally malformed but semantically intact output.

The provider path itself taught several lessons. Gemini 3.6 Flash successfully completed an initial 12-film production pilot, including bounded malformed-output retry recovery. Gemini 3.7 Flash was operationally unreliable during the relevant window, with repeated 503/high-demand behavior and an unsuccessful smoke. We did not convert availability failures into claims about semantic intelligence.

Kimi then became the production provider for the scale experiment. High-first work proved the adapter and structured-output path; a bounded Low engineering screen showed that Low was viable enough to try as the first production tier. The resulting policy for new cohorts became:

> **Low → High → Max, but only on completed semantic-validation failure.**

Provider/network failures never triggered effort escalation. Unknown dispatches stopped the batch rather than being replayed automatically.

Across the fresh Semantic-200, Semantic-300 and Semantic-400 tranches, 300 fresh films reached 300/300 final validity. Low was first-pass valid for 267/300 (89.0%). High was attempted 33 times and Max 7 times. There were zero provider failures and zero uncertain dispatches in those fresh tranches.

Two records—*Friday the 13th Part 2* and *The Golden Glove*—became especially educational. Their semantic choices were stable, but their evidence containers were malformed. Strict validation stopped production. We inspected the raw responses, proved the content could be reconstructed without changing meaning, performed candidate-bound deterministic offline recovery, preserved all historical attempts/usage/failure events, and required the normal strict validator to pass before changing manifest state. No additional model calls were used for either recovery.

That is the V8.1 result worth remembering:

> **The pipeline did not prove its value when the model succeeded. It proved its value when the model failed in a strange but recoverable way and the system refused to hide it.**

V8.1 closed intentionally at the cumulative **Semantic-400: 400/400 valid** checkpoint and released as `v8.1.0` at commit `ac35888`. Semantic-500 was explicitly removed as a release requirement because 400 records had already answered the engineering question. Kimi catalogue production was closed. If a future expansion is authorized, the provider path is the **Gemini Flash family**, with the exact model selected at that future time rather than frozen now.

---

# 3. What makes this a strong “first vibe-coding” story

I would describe it this way in a portfolio or retrospective:

> Movie Mood began as my first attempt to build a complete software product through AI-assisted vibe coding, without a development team or an established software-engineering workflow. I started with a single React idea—pick a mood and get three films—and learned the rest by building, breaking, testing and revising real versions.
>
> Instead of treating AI-generated code as the finished product, I gradually built a process around it. Product decisions were separated from implementation. Versions gained explicit specifications and acceptance criteria. Repository-level agent instructions replaced repeated prompts. Pure recommendation and state logic gained automated tests. Git tags and releases became checkpoints. Higher-risk changes received independent review. External TMDB data was integrated without abandoning the static architecture, and human-curated meaning remained separate from machine-provided facts.
>
> The project also taught me that the hardest failures are often not syntax errors. We lost time to wrong working directories, duplicated context, unreliable model providers, CI ordering, secret handling, incorrect assumptions about external data and, most importantly, plausible product logic that was technically valid but wrong for the user.
>
> V6 became the clearest example. The implementation passed tests and worked in the browser, yet human testing showed that the decision interaction felt mechanical. Further review exposed a hidden logical asymmetry in the algorithm. Rather than release it because of sunk cost, we stopped implementation, returned to the actual user problem, and validated a smaller alternative against real catalogue slates.
>
> That changed what “vibe coding” meant for me. The AI could write code quickly, but the real work became defining the problem, constraining the solution, checking assumptions, designing invariants, validating behavior and knowing when not to ship.
>
> Movie Mood therefore grew through a simple sequence—**Mood → Context → Discovery → Decide → Real Movies → Simplify → Selective Decision Companion**—while remaining a static Vite + React + TypeScript application. The increasing sophistication came mostly from clearer product thinking and stronger engineering discipline, not from adding more infrastructure.
>
> The result is both a movie-decision product and a record of learning how to collaborate critically with coding agents rather than simply accepting their output.

I would **not** phrase the story as “built without any assistance,” because the AI systems were obviously part of the process.

The stronger and more credible claim is:

> **First software product built without an external human developer/team, while learning the engineering workflow through AI-assisted development.**

That actually makes the story more impressive, because the achievement isn't “the AI wrote everything.”

It's:

> **you learned how to direct, constrain, audit and sometimes reject the AI.**

---

### What the later versions add to that story

V7–V8.1 make the “first vibe-coding” story more credible, not less.

The beginner lesson is that AI assistance does not remove the need to learn software engineering; it changes where the human must become strong. The human does not need to type every line, but must increasingly own:

- problem selection;
- scope;
- acceptance criteria;
- architecture boundaries;
- data provenance;
- risk classification;
- testing strategy;
- visual/product judgment;
- cost and provider decisions;
- release/stopping decisions.

V8 showed that code quality cannot compensate for an unclear visual target. V8.1 showed that model intelligence cannot compensate for weak pipeline guarantees. In both cases, the solution was not “use a smarter model.” It was to improve the surrounding decision process.

A concise portfolio version now is:

> **Movie Mood was my first complete software product built without an external human development team. I used AI systems as collaborators for ideation, implementation, review and research, but progressively built an engineering process around them: explicit product specs, repository-level agent rules, automated tests, runtime acceptance, static-data architecture, release checkpoints, provenance-bound catalogue production and fail-closed recovery. The project taught me to distinguish generated code from accepted product behavior—and to treat stopping, rejecting, or redesigning AI output as part of successful development.**

# 4. The workflow we should carry forward

If I compressed everything we learned into one operating model, it would be:

```text
Product problem
      ↓
cheap/manual validation first
      ↓
lock version scope
      ↓
one normative implementation spec
      ↓
AGENTS.md supplies permanent operating rules
      ↓
agent implements bounded phase
      ↓
automated tests verify reusable invariants
      ↓
human checks actual UX
      ↓
independent audit for high-risk/release work
      ↓
commit / tag / release
      ↓
retrospective feeds the next version
```

And five rules deserve to become permanent:

**Do not let chat history be the source of truth.**
**Do not let passing tests substitute for human acceptance.**
**Do not let available metadata determine the product question.**
**Do not let implementation order make hidden product decisions.**
**Do not keep polishing a mechanism after evidence says the mechanism itself is wrong.**

## 4.1 The workflow now has three different acceptance gates

The earlier workflow was correct but incomplete. Later versions showed that “human checks actual UX” needs to be separated into distinct gates:

```text
Product problem
      ↓
cheapest manual / no-code validation
      ↓
PRODUCT GATE
Does the mechanism solve a real problem?
      ↓
for visual work:
references → composition mockups → desktop/mobile intent
      ↓
PERCEPTUAL GATE
Would a user actually notice and understand the intended change?
      ↓
lock scope + one normative spec
      ↓
implementation
      ↓
tests / typecheck / build / runtime checks
      ↓
ENGINEERING GATE
Is the implementation correct and regression-safe?
      ↓
focused independent review when risk justifies it
      ↓
release
      ↓
retrospective
```

A version can pass one gate and fail another:

- V6 initially passed engineering and failed product acceptance.
- V7.2 passed engineering but underperformed the perceptual ambition.
- V8 deliberately solved the perceptual problem without changing semantics.
- V8.1 mostly concerned engineering/data-production validity rather than visible UX.

## 4.2 A separate workflow for live/API data production

External-model catalogue production needs a different loop from UI work:

```text
freeze candidate + evidence identity
      ↓
zero-call preflight
      ↓
authorize bounded live work
      ↓
persist dispatch before/with request boundary
      ↓
validate output strictly
      ↓
success → immutable artifact
      ↓
semantic invalid → allowed effort escalation
provider/network failure → no semantic escalation
unknown dispatch → stop
      ↓
resume from manifest, never from memory
```

When a live run stops, **inspect state before rerunning**. Silence in the terminal is not evidence of failure, and a prior request with uncertain transport state must not be replayed casually.

## 4.3 Permanent beginner rules

1. **Know which folder you are changing.** Verify `pwd`, remote, branch and checkpoint before edits.
2. **Git is your safety net, not decoration.** Make small coherent commits and tag meaningful releases.
3. **Do not use `git add .` in a dirty project.** Stage only intended files.
4. **Tests prove encoded behavior, not user value.**
5. **A build proves the project compiles, not that the layout looks right.**
6. **A media query proves intent, not computed runtime CSS.**
7. **Do the cheapest test first.** A paper example can invalidate an interaction before React state exists.
8. **Do not let enums become interface copy automatically.**
9. **Do not let array order or implementation convenience make product decisions.**
10. **Separate facts from editorial meaning.**
11. **Treat external API data as untrusted input with a real contract.**
12. **Never put secrets in source, prompts, screenshots, logs or pasted chat text.**
13. **Distinguish provider failure, network failure, semantic invalidity and unknown dispatch. They require different actions.**
14. **Preserve raw failed artifacts before attempting recovery.**
15. **Make recovery narrower than the failure.** Do not generalize one anomaly into global normalization without evidence.
16. **Use expensive/strong models where the cost of a mistake is high, not simply because they are available.**
17. **Independent review should be independent.** Give the reviewer evidence and acceptance criteria, not a prompt that pressures agreement.
18. **After one blocker is fixed, do a focused recheck.** Do not restart the whole audit ritual.
19. **Visual redesign requires a visual target.** Do not turn adjectives like “cinematic” into CSS before composition is decided.
20. **A stopping rule is an engineering feature.** More movies, more tests, more audits or more model calls are not automatically progress.

---

# 5. Product learning and engineering learning must stay separate

This distinction became one of the most important habits in the project.

## Product lessons

### The user is trying to reduce cognitive work, not operate a recommendation schema

Mood, attention, pace, emotional weight, discovery style and runtime can all be useful internally. That does not mean they deserve equal UI presence. V5.2 and V6 repeatedly showed that abstract self-report can become work in itself.

The product should generally:

- show movies earlier;
- ask fewer questions;
- use internal metadata to explain meaningful differences;
- let neutral metadata stay silent;
- prefer recognition (“this one stands apart”) over taxonomy interrogation when possible.

### Elimination can be easier than ranking

The move from “pick two finalists” to “drop one” was psychologically meaningful. The user can often identify the least-fitting option without having to rank all three.

### Product interventions must earn their right to exist

V6 established a strong rule:

> If Movie Mood cannot explain why an intervention helps, it should stay silent.

A detectable metadata split is not enough. It must be salient, coherent and understandable in the moment.

### Visual identity is product behavior

V7.2 and V8 corrected an earlier tendency to treat visual work as polish. Hierarchy, atmosphere, spatial emphasis and transitions change how the user perceives confidence, choice and closure.

A visual version should be judged by questions such as:

- Is the new state perceptually distinct?
- Does the screen's hierarchy match the user's psychological state?
- Does Full Reveal feel meaningfully different from Glimpse?
- Do Duel finalists feel equally legitimate?
- Does Tonight's Pick feel like a conclusion rather than another card?

### “Preserve semantics” does not mean “preserve layout”

This is a permanent correction to earlier scope discipline. Conservatism is good when protecting meaning and working behavior. It is harmful when it prevents a version whose explicit purpose is experiential change from changing the experience enough to matter.

## Engineering lessons

### Static architecture remained a strength

V5 proved that “real data” did not require a runtime backend. TMDB work stayed maintainer-side, facts were committed, and the browser remained credential-free.

V8.1 extended the same philosophy: complex AI-assisted catalogue production happened offline. The runtime application did not need to become an AI application.

### Deterministic logic deserves tests; perceptual behavior deserves runtime inspection

Tests are excellent for filtering, state transitions, URL codecs, manifests, budgets and recovery invariants. They are poor substitutes for judging atmosphere, hierarchy or whether a user understands a choice.

Use the right verification medium for the risk.

### Provenance is what makes AI output maintainable

An AI-generated field without identity is difficult to trust later. V8.1 bound artifacts to candidate, factual/evidence hashes, provider, model, prompt, schema, taxonomy and calibration inputs. That allowed later runs to import prior results without pretending they were regenerated.

### Resumability is not only a convenience feature

A resumable manifest is a safety mechanism. It limits duplicate calls, survives quota/provider interruptions, separates historical from current-run accounting, and makes “what happened?” answerable after a long batch.

### Fail-closed is especially important around external models

When the system cannot prove whether a request completed, whether an artifact is valid, or whether identity matches, guessing is more dangerous than stopping.

---

# 6. Model / agent collaboration lessons

No single model should own the entire lifecycle. The best results came from routing work by **task type and risk**, not loyalty to one provider.

| Role | What worked | Failure mode to avoid |
| --- | --- | --- |
| **ChatGPT / strong reasoning model** | Product synthesis, architecture, difficult debugging, prompt/spec design, cross-version memory, acceptance critique, forensic diagnosis of strange failures. | Becoming an endless strategy loop or repeatedly reopening frozen decisions. |
| **Codex / coding agent** | Repository inspection, bounded implementation, tests, refactors, Git-scoped commits, reproducing and fixing concrete code paths. | Treating its own tests/report as final product acceptance; coding before product/visual decisions are locked. |
| **Gemini** | Independent critique and alternative reasoning; useful external semantic provider experiments; future Flash family chosen for any new expansion phase. | Repeated availability retries; interpreting provider 503s as model-quality evidence; letting another model restart settled debates. |
| **Claude** | Strong human-facing copy/UX critique and presentation thinking, especially around microcopy and exposing taxonomy. | Treating aesthetically plausible suggestions as automatically consistent with Movie Mood's full flow. |
| **Hermes / free or cheaper agents** | Bounded, low-risk tasks where errors are cheap and easy to verify. | Spending more human time rescuing an unreliable provider than the cost savings justify. |
| **Independent reviewer** | Catching release/acceptance issues the implementing agent normalized away, including runtime/CSS problems. | Redundant full audits after a single known blocker is fixed. |

### Route work by risk

A practical routing rule emerged:

- **Routine/mechanical work**: use a cheaper/faster capable model.
- **Architecture, data integrity, subtle state, first live production, hard debugging**: use the strongest reliable model justified by the risk.
- **Visual/product acceptance**: a coding model's self-report is not enough; inspect the real experience.
- **Independent critique**: give the reviewer the artifact and acceptance criteria. Do not tell it what conclusion to reach.

### Preserve disagreement

Multiple models are useful when they produce genuinely independent perspectives. They become wasteful when one model is asked to paraphrase another's answer until everyone agrees.

A good pattern is:

```text
Model A proposes
Model B critiques independently
human compares evidence
decision is frozen
implementation begins
```

A bad pattern is:

```text
Model A proposes
Model B is shown A's conclusion and asked if it agrees
Model C re-reviews the agreement
repeat
```

### The implementing agent should not automatically be the release authority

The implementer is optimized to make the code satisfy the task. Acceptance asks a different question: *did we ask for the right thing, and does it work for a person?*

Keep those roles separate when the risk justifies it.

---

# 7. Efficiency analysis: where we spent too much and what to do instead

## Work that should be combined

Routine implementation, focused tests, diff inspection, commit and push can normally be one bounded agent task. Splitting each into separate conversational approvals turns the maintainer into a manual workflow engine.

## Work that should be split earlier

Product exploration and implementation should be separated earlier than we did in some versions. V6 interaction logic and V8 visual work both showed the cost of converting a hypothesis into code/spec too soon.

For new mechanisms:

```text
examples / sketches
→ manual acceptance
→ data feasibility
→ frozen behavior
→ implementation
```

For major visual work:

```text
experience thesis
→ references
→ compositions
→ choose one
→ responsive intent
→ spec
→ code
```

## Reviews should match the uncertainty

Do not run a full release audit when only one isolated blocker changed. Use a focused recheck unless the fix can affect broad state.

Conversely, do not skip independent review just because tests are numerous. Test count is not review breadth.

## Stop reconstructing context in every prompt

The repository should carry stable instructions. The current version should have one normative spec. Historical reasoning belongs here in the retrospective, not in every coding prompt.

## Avoid ritual phases

A phase is allowed to produce **no code change** if inspection shows the current behavior already satisfies the goal. Creating code merely to complete a named phase is waste.

## Match model cost to decision cost

Do not spend a scarce strong model on documentation, repetitive file edits or straightforward transformations. Do spend it when a wrong answer could corrupt provenance, create a subtle state bug, or waste a live external-data run.

## Use preflight and hard budgets for live work

V8.1's strongest efficiency pattern was not a cheaper model; it was controlling the maximum damage of a live invocation.

A live batch should know:

- exactly which candidates are eligible;
- how many fresh calls are allowed;
- how many HTTP requests are allowed;
- what counts as a retry;
- what state means “do not redispatch”;
- how to resume.

## Read before retrying

Two V8.1 terminal failures would have been more expensive if we had responded with another model request. Read-only inspection showed that the semantics were already present and only the containers were wrong.

The permanent sequence is:

```text
failure
→ inspect raw artifact + manifest
→ classify failure type
→ decide whether another call can actually address it
→ only then spend quota
```

## Do not optimize an opaque metric as if it were known

Kimi membership limits were not a simple public function of provider tokens. We could compare observed token usage, latency and validity, but should not pretend to know exact quota economics.

When the billing/quota function is hidden, optimize the measurements we actually have and label assumptions honestly.

---

# 8. Version-specific retrospective: V7.2 → V8 → V8.1

## V7.2 — Earned Atmosphere

**Original goal:** make the existing decision flow feel more intentional and emotionally coherent without changing core semantics.

**What shipped:** stronger hierarchy and atmosphere around Duel/Tonight's Pick, watch action emphasis, restrained motion, tested/deployed as `v7.2.0`.

**What went wrong:** the release was technically sound but the user judged the visual change too subtle. An independent audit also found a mobile CSS specificity issue.

**What changed:** visual success was no longer defined by “did we avoid regressions?” It required perceptual difference.

**Carry forward:** visual versions need screenshot/transition/runtime acceptance. Computed CSS beats source inference.

## V8 — Cinematic Identity

**Original goal:** make Movie Mood visually distinctive and cinematic without adding product logic.

**What changed during development:** early concept demos proved that “cinematic” is not a sufficient implementation brief. Some directions looked generic, AI-generated, or detached from the actual site layout.

**What worked:** visual exploration before implementation; explicit rejection of generic design tropes; composition-first thinking; separating semantics from layout; real-site fidelity.

**What should carry forward:** do not lock an implementation spec until the visual composition can be evaluated as a composition. Describe desktop and mobile before CSS. Preserve interaction meaning, not every existing box.

## V8.1 — Catalogue Scaling & Production Pipeline

**Original goal:** investigate whether Movie Mood could scale from a small curated catalogue toward hundreds/1,000+ semantic records while preserving meaning, provenance and reproducibility.

**What actually shipped:** an offline, resumable production architecture plus a validated cumulative Semantic-400 checkpoint. `v8.1.0` closed at 400/400 valid records.

**Major direction changes:**

- Wikipedia-dependent C1b confirmation was closed when operationally blocked rather than endlessly repaired.
- Gemini 3.7 Flash was not pursued after bounded operational failures.
- Kimi became the production provider for the experiment.
- High-first established the path; Low-first became the production policy for later cohorts.
- Two terminal semantic records were repaired offline after proving the defect was structural rather than semantic.
- Semantic-500 was intentionally not pursued.

**What went wrong:**

- external-source rate limiting;
- provider availability failures;
- malformed structured output despite HTTP 200;
- risk of over-auditing and over-generalizing rare failures;
- potential confusion between tokens and opaque quota economics.

**What worked especially well:**

- identity-bound artifacts;
- hard budgets;
- resumable manifests;
- zero-call preflight;
- fail-closed unknown dispatch;
- strict semantic validation;
- keeping raw failed responses;
- deterministic recovery without semantic rewriting;
- an explicit stopping rule.

**Final production evidence for fresh Semantic-200/300/400 tranches:**

| Measure | Result |
| --- | ---: |
| Fresh films | 300 |
| Low attempts | 300 |
| Low first-pass valid | 267 (89.0%) |
| High attempts | 33 |
| Max attempts | 7 |
| Provider failures | 0 |
| Uncertain dispatches | 0 |
| Deterministic offline recoveries | 2 |
| Final valid | 300/300 |
| Provider total tokens | 1,875,662 |
| Mean provider total tokens / fresh film | ~6,252 |

Provider total tokens are planning/provenance metadata, **not** a conversion to Kimi membership quota.

**Closure decision:**

```text
V8.1: CLOSED
SEMANTIC CATALOGUE CHECKPOINT: 400/400
KIMI PRODUCTION: CLOSED
SEMANTIC-500: INTENTIONALLY NOT PURSUED
FURTHER SCALE: OPTIONAL
FUTURE EXPANSION PROVIDER: GEMINI FLASH FAMILY
```

## V8.2 — Catalogue Promotion & Governance Evolution

**Original goal:** Promote accepted offline-produced semantic candidates from Semantic-400 into the static runtime catalogue without weakening editorial meaning, factual integrity, or the pure static architecture.

**What V8.2 delivers:** 139 promoted records join the original 41 curated baseline films, expanding the live static catalogue from 41 to **180 movies**. Zero runtime mutations, zero runtime external calls.

**Key results:**

| Metric | Result |
| --- | ---: |
| Baseline runtime catalogue | 41 |
| Tranche 3 normal candidate cohort | 150 |
| Human semantic accepted | 139 |
| Pre-human terminal exclusions | 2 |
| Structural quarantine | 9 |
| Deferred outside normal cohort (`exp100-tmdb-1156593`) | 1 |
| Stage 2 poster acquisition | 139/139 (100%) |
| Stage 2 palette generation | 139/139 (100%) |
| Successor production assembly | 139/139 (100%) |
| Production promotion | 139/139 (100%) |
| Final live runtime catalogue | 180 (100% unique runtime & TMDB IDs) |
| Runtime identity/mapping overlaps/conflicts | 0 / 0 / 0 |
| Runtime semantic/factual/poster/palette mutations | 0 |
| Runtime assembly external calls | 0 network, 0 provider |
| Gemini physical dispatch attempts | 151 / 180 cap (headroom: 29) |
| Rollback invocations during live write | 0 |

**Major engineering & governance lessons:**

1. **Product Evolution vs. Catalogue/Governance Evolution:**
   The product remains intentionally static, lightweight, and mood-first. Catalogue scaling is strictly maintainer/offline infrastructure. Runtime code was not compromised with backends, database layers, or dynamic API calls.

2. **Source-Boundary Safeguards & Materiality:**
   Structural validity (well-formed JSON, schema passing) is not semantic validity. Bounded source-grounding checks prevent models from asserting unsourced mechanisms, character motivations, or lore outside the evidence packet.

3. **Human Review Governance (Machine can BLOCK; machine cannot ACCEPT):**
   Automated tooling filters out syntax defects, length violations, and contract breaches so human review focuses strictly on semantic and editorial judgment. Models provide evidence, never promotion authority.

4. **Failure Separation & Lawful Successor Execution:**
   When historical dry runs encountered missing local poster assets, failure was quarantined and reconciled via a lawful successor dry run without modifying historical ledgers or papering over evidence.

5. **Promotion vs. Runtime Separation & Prospective Binding:**
   Candidate records were promoted to production records and prospective bytes were frozen and hashed *before* runtime writes were authorized.

6. **Source-Hash-Bound Atomic Runtime Transaction:**
   The live runtime write was bound to exact input and prospective hashes across all three runtime files (`curatedMovies.ts`, `tmdbMovies.json`, `tmdbMovieMappings.json`). The executor executed with staging, atomic replacement, post-write readback, and fail-closed rollback.

7. **Model Routing Economics:**
   High-consequence governance gating (e.g. final gate audits) was reserved for Codex, while routine deterministic execution, validation, and documentation was routed to Gemini Flash, staying well within the 180 physical call budget (151 calls used, 29 headroom).

**Release candidate status:**

```text
V8.2 RELEASE CANDIDATE: COMPLETE
RUNTIME ASSEMBLY: COMPLETE
RELEASE: PENDING
RUNTIME CATALOGUE: 180 FILMS (41 BASELINE + 139 PROMOTED)
TRANCHE 3 COHORT: 150 (139 ACCEPTED, 2 TERMINAL EXCLUDED, 9 QUARANTINED)
GEMINI PHYSICAL CALLS: 151 / 180 (29 HEADROOM)
RUNTIME MUTATIONS: 0
RUNTIME EXTERNAL CALLS: 0
STATIC RUNTIME ARCHITECTURE: PRESERVED
```

---

# 9. Process improvements that are now permanent

These rules supersede or qualify earlier guidance where necessary.

1. **Scope discipline is not visual timidity.** Preserve product meaning and working behavior; allow major composition change when the version goal is perceptual.
2. **No implementation spec before the product mechanism is accepted.**
3. **No visual implementation spec before the visual composition is accepted.**
4. **Passing tests/build is an engineering gate, not a product or perceptual gate.**
5. **For CSS/responsive work, inspect runtime/computed layout at representative breakpoints.**
6. **Use a focused recheck after fixing one known blocker instead of repeating an entire audit.**
7. **A phase may finish with no code if no change is justified.**
8. **Do not let metadata availability define user-facing questions.**
9. **Do not let implementation order select winners/losers silently.**
10. **Treat microcopy as part of interaction architecture when it carries semantics.**
11. **Keep facts, editorial meaning and presentation as separable layers.**
12. **Before live API/model calls, freeze identity, run preflight, define budgets and define stop conditions.**
13. **Never auto-retry an uncertain prior dispatch.**
14. **Provider/network failures do not justify semantic effort escalation.**
15. **Preserve raw failed outputs. Diagnose before retrying.**
16. **Recovery must preserve history rather than rewriting failure into an imaginary clean success.**
17. **Do not convert one strange production incident into a global normalization rule without repeated evidence.**
18. **Do not claim cost/quota precision the provider does not expose.**
19. **Use stronger models for high-consequence reasoning, not routine file manipulation.**
20. **Freeze a decision once the evidence is sufficient. Do not reopen it just because another model is available.**
21. **A milestone is allowed to stop below a round target when its learning goal is complete.**
22. **Keep the project understandable to a beginner. Cleverness that cannot be audited later is a liability.**

---

# 10. Future-chat handoff: what a new agent must know

A future agent should begin here, not by reconstructing years of chat.

## Product identity

Movie Mood is a decision companion, not a streaming catalogue browser.

> Streaming platforms help you find more movies. Movie Mood helps you choose one.

The product prefers:

- three meaningful choices over infinite browsing;
- progressive disclosure over dashboards;
- human-language interpretation over raw taxonomy;
- explicit user agency over hidden ranking;
- silence over weak/forced intervention;
- deterministic, explainable behavior over fake personalization.

## Architecture identity

The runtime remains intentionally simple:

- Vite;
- React;
- TypeScript;
- plain CSS;
- GitHub Pages;
- static committed catalogue/data;
- no accounts/backend/database;
- no runtime authenticated TMDB call;
- no runtime AI dependency.

Do not add infrastructure merely because a larger product “normally” would have it.

## Data identity

> Movie Mood owns meaning. TMDB owns facts.

TMDB facts can still affect behavior, so they are versioned/reviewed. Movie Mood semantic fields are editorial/product decisions, not facts to outsource blindly.

V8.1's AI-assisted semantic production is offline maintainer tooling. It does not make the runtime app an AI product.

## Visual identity

V8 established that cinematic identity comes from composition, hierarchy, atmosphere and controlled contrast—not generic “AI UI” decoration.

Avoid by default for Movie Mood:

- blue-purple gradient aesthetics;
- emoji/purely decorative icons;
- default three equal-width-card grids;
- corner radii above roughly 8px unless explicitly justified;
- large decorative drop shadows;
- hover enlargement;
- generic hero headline/subtitle/button compositions.

These are project-specific preferences, not universal design laws.

## Engineering operating rules

Before changing anything:

```text
verify repo root
verify remote
verify branch / checkpoint
inspect git status
read current normative spec / task
identify unrelated dirty work
```

During implementation:

```text
change only the requested scope
test reusable deterministic logic
inspect actual UI for visual work
never stage unrelated work
```

Before release:

```text
technical verification
human/product acceptance
perceptual/runtime acceptance when relevant
focused independent review if risk justifies it
tag / release / record closure
```

For live data/model work:

```text
preflight
budget
authorize
persist state
validate
stop on uncertainty
resume from manifest
```

## Closed questions: do not casually reopen

- Kimi catalogue production is closed after V8.1.
- Semantic-500 is not unfinished V8.1 work.
- Future catalogue expansion, if authorized, uses the Gemini Flash family; choose the exact future model then.
- Do not reopen old C1b/Wikipedia confirmatory work simply to obtain a cleaner ending.
- Do not generalize the two candidate-bound structural recoveries into silent production normalization without new evidence.
- Do not add backend/accounts/runtime AI unless a future version has a demonstrated product need.

## The biggest meta-lesson

The project improved whenever the human/agent collaboration moved from:

> “Generate something plausible.”

toward:

> **Define the problem → make the decision explicit → choose the cheapest valid test → implement a bounded solution → verify with the right kind of evidence → stop when the question is answered.**

That is the core engineering lesson of Movie Mood, and probably the most valuable thing this first vibe-coding project produced.
