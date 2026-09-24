# Movie Mood Playbook

**Purpose:** a compact operational guide for Sophia, a future contributor, or any AI agent returning to Movie Mood after a break.

This document is deliberately shorter than `PROJECT_RETROSPECTIVE.md`. The retrospective explains **why** the project learned these rules. This playbook says **what to do now**.

> **Streaming platforms help you find more movies. Movie Mood helps you choose one.**

> **Movie Mood owns meaning. TMDB owns facts.**

---

## 1. Product identity

Movie Mood is a decision companion, not a general movie database, search engine, recommender platform, social network, or runtime AI product.

The core flow should keep reducing decision friction rather than creating more browsing work.

When evaluating a new idea, ask:

1. What user problem does this solve tonight?
2. Is this easier to validate manually before coding?
3. Does it preserve Movie Mood's role as a chooser rather than a catalogue browser?
4. What evidence would prove the idea is not worth building?
5. What is the stopping rule?

---

## 2. Runtime architecture

Current architecture is intentionally simple:

- Vite + React + TypeScript;
- static GitHub Pages deployment;
- no backend, database, accounts, or runtime model provider;
- Movie Mood editorial/semantic data committed locally;
- TMDB factual snapshots acquired at maintainer time;
- poster images served through the TMDB image CDN;
- AI/model work, when used, happens offline during catalogue maintenance.

Do not add infrastructure because a larger product would normally have it. Add it only after a concrete runtime problem demonstrates the need.

---

## 3. Repository safety

Canonical local repository:

`/Users/hermes/code/movie-mood`

Before any meaningful task:

```text
verify pwd
verify origin
verify branch / HEAD / relevant tag
inspect git status --short
identify unrelated dirty work
read the current normative spec or authorization artifact
```

Never assume a folder named `movie-mood` is the correct checkout.

Never use broad cleanup to make the repository look tidy.

Do not run `git add .` in a dirty research repository. Stage exact intended paths, inspect `git diff --cached`, and preserve unrelated work.

---

## 4. Know what kind of evidence you have

Do not merge these categories mentally:

- **product evidence** — does the experience help a person choose?
- **perceptual evidence** — can a user actually see/feel the intended visual change?
- **technical evidence** — tests, type checking, build, deterministic invariants;
- **retrospective development evidence** — useful for learning and repair, but not automatically future performance;
- **prospective validation evidence** — frozen protocol applied to unseen material;
- **production authorization** — explicit authority to promote or write production state;
- **runtime/release evidence** — what is actually committed, deployed and released.

A PASS in one category does not imply a PASS in another.

---

## 5. Product changes: cheapest falsification first

Before implementing a new interaction or visual mechanism:

```text
human problem
→ smallest manual/no-code example
→ try real catalogue cases
→ PRODUCT GATE
→ if visual, composition/reference exploration
→ PERCEPTUAL GATE
→ bounded implementation
→ ENGINEERING GATE
```

Examples learned the hard way:

- a clean 2:1 metadata split is not automatically a useful question;
- passing tests does not mean an interaction feels natural;
- valid CSS does not prove the computed mobile layout is correct;
- a source-code visual change can still be perceptually too subtle;
- a beautiful concept page can fail if it does not map onto the real product flow.

---

## 6. Catalogue semantics and facts

**Movie Mood owns meaning. TMDB owns facts.**

TMDB may supply factual fields such as title, year, director, countries, runtime, genres, poster path, and potentially future rating/vote data.

Movie Mood owns semantic/editorial fields such as moods, situations, pace, emotional weight, attention demand, discovery style, descriptions, reasons-to-watch and decision-facing copy.

A fact being visible somewhere does **not** automatically authorize semantic copy.

For source-boundary review:

- energy ≠ pace;
- involvement ≠ direct causality;
- suspicion ≠ confirmed deception;
- nationality / production country ≠ authorized story location;
- fantasy atmosphere ≠ specific world physics;
- supernatural tone ≠ a specific fiction–reality mechanism;
- keyword metadata ≠ authorized semantic material when the governing protocol excludes it;
- same outcome ≠ permission to invent a different causal pathway.

Human semantic authority remains the positive acceptance authority wherever the production contract requires it. Machines may block; they do not silently redefine acceptability.

---

## 7. Filtering and recommendation rules

Treat user inputs by intent, not by what is easiest to code.

Current design principle:

- mood is the primary anchor;
- situation may relax when the exact pool is too small;
- true dealbreakers are hard exclusions;
- attention/discovery preferences are ranking signals;
- practical filters should not silently disappear.

When changing filtering logic, explicitly decide whether each input means:

**must have** / **prefer** / **avoid**.

Do not let a TypeScript enum or checkbox implementation decide that meaning accidentally.

If a combination becomes too narrow, prefer a transparent fallback such as “closest fits” over silently violating a hard constraint.

---

## 8. External APIs and model providers

Before a live external call:

```text
freeze candidate identity
freeze input/source hashes when material
run zero-call preflight
set call/retry budget
persist dispatch intent before network work
preserve raw response/failure
validate strictly
stop on ambiguous delivery
resume from durable state, not memory
```

Failure classes are different:

- provider availability / rate limit;
- network or transport failure;
- provider-specific schema incompatibility;
- malformed structured output;
- semantic invalidity;
- ambiguous dispatch.

Do not respond to all of them with “retry using a stronger model.”

Never automatically replay an ambiguous prior external dispatch.

Preserve raw failures before repair. Recovery should be narrower than the failure and should not rewrite history into an imaginary clean run.

---

## 9. Model routing

Use model strength where the consequence of a wrong decision justifies it.

A practical default:

- deterministic hashes, counts, manifests, known tests, mechanical docs → cheap/reliable execution model such as Gemini Flash;
- normal repo-aware implementation/synthesis → capable mid/high reasoning coding model;
- semantic governance, difficult architecture, independent release-critical review → strongest justified reasoning model;
- deterministic script with an objective oracle → prefer the script over another model call.

Independent review belongs at real decision boundaries, not after every small correction.

After a blocker is fixed, run a focused recheck rather than restarting the entire audit ritual.

---

## 10. Git and release discipline

Before staging:

```text
inspect status
classify intended vs unrelated files
stage exact paths only
inspect cached name/status and stat
inspect staged diff sufficiently
run git diff --check
```

Before release:

```text
run normal tests
run typecheck
run production build
verify runtime/catalogue invariants
push without force
verify deployment for the exact release commit
then tag and publish release
```

Never move a published release tag to make later documentation tidier.

---

## 11. Stopping rules

A stopping rule is an engineering feature.

Stop when the question is answered, even if:

- the count is not round;
- another model could still review it;
- another experiment could produce more evidence;
- more catalogue records already exist offline;
- one more refactor might look cleaner.

More movies, more tests, more reviews and more model calls are not automatically more progress.

---

## 12. The five-question pre-task check

For any substantial future Movie Mood task, answer these first:

1. **What human problem are we solving?**
2. **What is the cheapest reliable way to falsify the idea?**
3. **What is the source of truth for this task?**
4. **Which acceptance gate matters: product, perceptual, engineering, governance, or release?**
5. **What evidence will make us stop?**

A compact project rule:

> **Falsify cheaply → freeze the decision → execute narrowly → verify with the right evidence → stop.**

