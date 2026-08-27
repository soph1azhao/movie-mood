# Movie Mood — Catalogue Trial A Plan

**Status:** planning only.  
**Scope:** content experiment, not versioned app behavior.  
**Principle:** Movie Mood owns meaning. TMDB owns facts.

This plan documents how to use the V5.1 curation assistant to add a small batch of 5 carefully chosen movies, without changing app features, algorithms, or recommendation semantics.

---

## 1. Objective

Add 5 new curated movies using `pnpm curate:add`, then finish the Movie Mood meaning layer manually.

Success looks like:

- 5 movies present in `src/data/curatedMovies.ts`
- 5 additional mappings present in `src/data/tmdbMovieMappings.json`
- `pnpm sync:tmdb` refreshes the generated factual snapshot
- TMDB factual diffs reviewed for behavior-impacting changes
- `pnpm test` and `pnpm build` pass
- recommendation pool diversity improves modestly without any algorithmic change

This is a catalogue experiment, not a version feature.

---

## 2. Hard Limits

Do not:

- add app features or algorithm changes
- change `filterMovies.ts`, `discovery.ts`, `decision.ts`, `urlCodec.ts`
- add new mood/situation/filter/utility types
- add new UI components beyond what V5.1 already introduced
- change GitHub Pages workflow
- change `AGENTS.md`
- change package dependencies
- add backend, database, auth, provider APIs, or auto-sync

If during curation any movie's forced TMDB identity would meaningfully break recommendation behavior, keep it out of the trial rather than adjust the matching logic.

---

## 3. Selection Criteria for the 5 Movies

Each pick should satisfy all of:

1. **Clear TMDB identity.** Manual confidence that the TMDB record matches the intended film. No identity ambiguity tolerated in the trial.
2. **Real fit for Movie Mood meaning.** The film should naturally express one or more existing moods and at least one existing situation. If a movie only fits by stretching definitions, it is not a strong trial candidate.
3. **Adds diversity relative to the existing catalogue.** Prefer picks that expand mood coverage, country/language representation, runtime range, pace, emotional weight, attention demand, or discovery style without crowding one axis.
4. **Culturally recognizable enough to be a credible "what should I watch?" pick.** This is not an exhaustive archive; it is a small curated set.
5. **Single, primary director identity in TMDB.** Avoid films where the director field would be messy or contested for the sake of the trial.

Avoid for this trial:

- franchise installment fatigue where the entry is only meaningful in context
- films that are essentially unknown for the intended mood
- anything where TMDB mapping would be guesswork
- cataloguing merely because a TMDB record exists

---

## 4. Diversity Balance Target

The existing catalogue already has Movie Mood meaning. The trial should aim for modest, intentional coverage rather than quota-filling.

Suggested balance is expressed as coverage preferences, not rigid counts:

| Axis | Preference |
|---|---|
| moods | include at least one film where `suspenseful` or `exciting` deepens a currently lighter catalogue area, plus at least one `emotional` or `thoughtful` candidate |
| situations | prefer at least one `alone`, one `date-night` or `friends`, one `family`/`easy-watch` candidate |
| countries | prefer non-U.S. primary production identity for at least one or two picks, without forcing it |
| languages | prefer at least one pick whose `spokenLanguages` extend beyond English-only where TMDB facts support it |
| runtime | prefer at least one watchable-under-100-minute pick and one that stretches the upper end without breaking practical filters |
| pace | prefer one slower candidate and one brisk candidate |
| emotional weight | prefer at least one `heavy` or `moderate` candidate to balance the light catalogue |
| attention demand | prefer at least one `engaged` or `immersive` candidate |
| discovery style | prefer at least one `different` or `adventurous` candidate |

These are preferences for selection, not acceptance criteria for the dataset. The key rule is intentionality: each pick should be defensible as improving catalogue coverage, not just adding volume.

---

## 5. How to Use `pnpm curate:add` Safely

Workflow per film:

1. `TMDB_READ_ACCESS_TOKEN=... pnpm curate:add "<title>"`
2. Review the terminal candidate list and verify TMDB identity manually.
3. Enter the number for the correct match, or cancel if unsure.
4. Inspect the generated `docs/curation-drafts/<id>.md`.
5. Do **not** paste the draft into `curatedMovies.ts` yet.
6. Review whether the TMDB candidate matches the intended film; if not, do not proceed.
7. Manually fill in all Movie Mood meaning fields. No auto-guessing.
8. Add the curated entry to `src/data/curatedMovies.ts`.
9. Add the mapping to `src/data/tmdbMovieMappings.json`.
10. Run `TMDB_READ_ACCESS_TOKEN=... pnpm sync:tmdb`.
11. Review the printed behavior-impacting and display differences.
12. Run `pnpm test` and `pnpm build`.

Safety rules:

- If identity is ambiguous, skip the movie.
- If sync reports a behavior-impacting change that would alter recommendation behavior in a way we do not want, stop and decide before committing.
- If a movie's TMDB facts would force a bad fit into existing filters, treat that as a signal about the movie, not a signal to loosen filters.

---

## 6. Reviewing TMDB Factual Changes

After each `sync:tmdb` run, review:

- **Behavior-impacting differences.** Priority fields are runtime, genres, and movie-level filtered languages. Decide whether any change alters existing recommendation behavior.
- **Display-oriented differences.** Title, year, director, countries, spoken languages, poster path. These affect content, not algorithm.
- **Poster presence.** Decide whether the poster path is usable; if not, the CSS fallback remains intentional.
- **Git diff.** Review the generated snapshot diff and the curated/meaning edits together.

If a behavior-impacting difference is unexpected, pause and inspect rather than assume it is fine.

---

## 7. Suggested Candidate Pool

This is a suggested starting pool, not a predetermined final 5. Final selection should come from manual TMDB identity verification and editorial fit.

Suggested candidates to evaluate (title hints only):

1. A lighter or genre-forward non-English film for mood/situation diversity.
2. A slow, emotionally heavier film for emotional weight and pace diversity.
3. A shorter watchable film for runtime diversity.
4. A mid-length or brisk film that stretches pace/emotion range.
5. A familiar-but-different identity for discovery style and country/language range.

The existing catalogue should be inspected first to avoid redundant coverage. If a candidate duplicates an axis already well-covered, prefer another.

Do not finalize the 5 until each has a verified TMDB identity and a defensible meaning fit.

---

## 8. Editorial Completion Standard

A movie is only "trial complete" when:

- `id` is stable and unique
- `tmdbId` maps to one verified TMDB film
- `moods` are chosen, not defaulted
- `situations` are chosen, not defaulted
- `filterLanguages` reflect curated viewing-language judgment
- `pace`, `emotionalWeight`, `attentionDemand`, `discoveryStyle` are chosen
- `description`, `whyWatch`, `curiosityHook`, `vibeSummary` are written by a human
- `palette` is chosen
- sync confirms the factual snapshot is valid
- tests and build pass

Do not ship a movie with placeholder editorial fields.

---

## 9. Versioning Decision

This trial is catalogue content, not application behavior. It should not become `v5.2` app logic.

Recommended approach:

- **Keep it as an unreleased content experiment.**
- If the result is worth publishing, tag it as a content patch rather than a new version line. A reasonable tag is `v5.1.1-content-trial` or similar, only if tagging is desired at all.
- Do not invent a new semantic version unless there is an application-behavior reason.

Rationale:

- The app code does not change.
- The recommendation model does not change.
- The user-facing release story for app features stays on `v5.1.0`.
- Catalogue expansion is a content decision.

If the trial reveals a real app-side problem discovered during curation, that problem may be its own fix. Do not let content curation drive app versioning.

---

## 10. Rollback / Safety Net

If the trial goes sideways:

- Revert the curated and mapping edits.
- Revert the generated TMDB snapshot to the committed state.
- Nothing in the app runtime should depend on the trial movies, so removal should be content-only.
- Curation drafts may remain uncommitted while working, but do not commit draft files unless they are intentionally useful documentation; they are not app code.

---

## 11. Acceptance for This Plan

The plan is acceptable when:

- the selection criteria are clear
- the diversity target is documented
- the safe curation workflow is defined
- the TMDB review steps are explicit
- the versioning decision is intentional and conservative
- no app feature or algorithm changes are implied

---

## 12. Next Step After This Plan

The next step is to use this plan to select 5 movies and curate them through the V5.1 workflow, then review and decide whether the result is worth keeping, tagging, or discarding.
