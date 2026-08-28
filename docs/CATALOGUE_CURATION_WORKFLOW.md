# Movie Mood — Catalogue Curation Workflow

> **Goal:** add or update one curated movie safely, without changing app features, algorithms, types, or recommendation semantics.  
> **Principle:** Movie Mood owns meaning. TMDB owns facts.

This is a maintainer workflow, not a user feature. It is used to grow the curated catalogue with help from the V5.1 curation assistant, then finish the Movie Mood meaning layer by hand.

---

## When to use `pnpm curate:add`

Use `pnpm curate:add` when you want to add a movie and you need TMDB search help to locate the right TMDB record.

It is useful for:
- reducing manual copy-paste of TMDB facts
- getting a scaffold draft with all `CuratedMovie` fields present
- checking that at least one TMDB match exists for your chosen title

It is **not** a decision tool. It does not choose moods, situations, pace, emotional weight, attention demand, discovery style, description, whyWatch, curiosityHook, vibeSummary, palette, or filterLanguages.

It is also not required. If you already know the exact TMDB ID and do not want to search, you can go straight to manual edits.

---

## Basic workflow

1. Search TMDB for a title with the curation assistant.
2. Verify that the TMDB candidate matches the intended movie.
3. Write the curated meaning by hand in `src/data/curatedMovies.ts`.
4. Add the mapping in `src/data/tmdbMovieMappings.json`.
5. Run `pnpm sync:tmdb` to refresh `src/data/generated/tmdbMovies.json`.
6. Verify the movie exists in all three places.
7. Run `pnpm test`, `pnpm build`, and `git diff --check`.
8. Stage data files and commit.

---

## Step 1 — Run the curation assistant

```bash
TMDB_READ_ACCESS_TOKEN="$TMDB_READ_ACCESS_TOKEN" pnpm curate:add "Movie Title"
```

If the token is unset, the command fails safely before touching any project files.

The assistant prints a short TMDB candidate list and waits for you to pick one. Enter the matching number, or leave the prompt empty to cancel.

It writes a draft to:

```text
docs/curation-drafts/<id>.md
```

The draft includes all required `CuratedMovie` fields as `TODO` placeholders. Do not copy the draft directly into `curatedMovies.ts` as final content.

---

## Step 2 — Verify TMDB candidate identity

Before you trust any TMDB result, confirm it is the right movie.

Check at least:
- exact title
- release year
- primary director
- country of origin, when it matters for your selection
- whether the record is the version you intend for a franchise or remake situation

If identity is not confident, cancel and choose a different search or a different movie. Do not proceed on a guess.

---

## Step 3 — Fill `curatedMovies.ts` by hand

Add one object to the `curatedMovies` array in `src/data/curatedMovies.ts`.

The file uses the `CuratedMovie` shape from `src/types/movie.ts`, so every field must be filled with real values, not placeholders, before you consider the entry complete.

### Required fields

- `id` — stable local ID, used by favorites and any future shared links. Pick something readable and keep it stable.
- `tmdbId` — the exact TMDB movie ID you verified.
- `moods`
- `situations`
- `filterLanguages`
- `pace`
- `emotionalWeight`
- `attentionDemand`
- `discoveryStyle`
- `description`
- `whyWatch`
- `curiosityHook`
- `vibeSummary`
- `palette`

### Valid values

The valid values come from the existing TypeScript types and existing data conventions.

**moods** — one or more of:

```text
funny
exciting
thoughtful
relaxing
emotional
suspenseful
```

Pick moods that genuinely describe the movie. Do not fill this from TMDB genres or popularity.

**situations** — one or more of:

```text
alone
date-night
friends
family
easy-watch
```

Pick situations that make sense for the intended watcher. `family` is a broad family movie-night signal, not an official age rating.

**filterLanguages** — an array of curated viewing languages.

These should reflect the languages the movie can be watched in for the kind of viewing this catalogue is meant to support. They are not the same as TMDB spoken languages. Choose them in the same style already used in the file.

**pace** — one of:

```text
slow
medium
fast
```

**emotionalWeight** — one of:

```text
light
moderate
heavy
```

**attentionDemand** — one of:

```text
easy
engaged
immersive
```

**discoveryStyle** — one of:

```text
familiar
different
adventurous
```

### Editorial fields

These must be written by a human. Do not leave them as draft placeholders in the committed catalogue.

- `description`
- `whyWatch`
- `curiosityHook`
- `vibeSummary`

Write them as actual Movie Mood copy. They should feel like a small, cinematic recommendation voice.

### Palette

`palette` is a two-color CSS tuple.

```ts
palette: ["#bc4c66", "#f0a25d"]
```

Pick two colors that suit the poster fallback treatment. They should feel consistent with the existing palette style.

### Stability note

Keep IDs stable after release. Favorites are stored by ID. Do not reuse or rename existing IDs casually.

---

## Step 4 — Add or verify `tmdbMovieMappings.json`

`src/data/tmdbMovieMappings.json` is the exact mapping list used by `pnpm sync:tmdb`.

It maps local IDs to TMDB IDs:

```json
{ "id": "some-movie", "tmdbId": 123456 }
```

For each new movie:
- add one mapping object
- use the same `id` you used in `curatedMovies.ts`
- use the same `tmdbId` you verified

If the mapping is missing or wrong, `sync:tmdb` cannot refresh the factual snapshot correctly.

---

## Step 5 — Refresh factual data

After the curated entry and mapping are in place, run:

```bash
TMDB_READ_ACCESS_TOKEN="$TMDB_READ_ACCESS_TOKEN" pnpm sync:tmdb
```

This command:
- reads the mappings
- fetches TMDB facts for those IDs
- validates the snapshot before replacing it
- writes `src/data/generated/tmdbMovies.json`

It may also report behavior-impacting differences. Read that output.

The token is read from the process environment only. It must not be committed, exposed through `import.meta.env`, or shipped to GitHub Pages.

Normal app usage, tests, builds, and GitHub Pages deployment do not require a TMDB token.

---

## Step 6 — Verify the movie exists in all three layers

Before you commit, confirm:

1. The movie is in `src/data/curatedMovies.ts`.
2. The movie is in `src/data/tmdbMovieMappings.json`.
3. The movie is in `src/data/generated/tmdbMovies.json` after sync.

Also confirm:
- `id` matches across `curatedMovies.ts` and `tmdbMovieMappings.json`
- `tmdbId` matches across `curatedMovies.ts`, `tmdbMovieMappings.json`, and `generated/tmdbMovies.json`

If any of those is missing or mismatched, stop before committing.

---

## Step 7 — Required checks

Run all three:

```bash
pnpm test
pnpm build
git diff --check
```

These checks exist because the catalogue is part of the app build surface.

- `pnpm test` ensures the build + existing logic still pass.
- `pnpm build` ensures the movie resolves cleanly through `src/data/movies.ts`.
- `git diff --check` ensures the staged or unstaged changes are clean.

If any one of them fails, do not commit until it passes.

---

## Files to stage

Stage:
- `src/data/curatedMovies.ts`
- `src/data/tmdbMovieMappings.json`
- `src/data/generated/tmdbMovies.json`

That is the core set for a catalogue change.

---

## Files not to stage

Do **not** stage:
- `docs/curation-drafts/` — those drafts are intermediate artifacts, not app code

If a draft is useful for your own review, keep it locally. It does not belong in the committed app tree.

---

## One-movie-per-commit recommendation

Prefer one movie per commit when you can.

That makes:
- review easier
- rollback easier
- TMDB diff review easier

If you are adding multiple movies, do it in separate commits unless you have a clear reason to bundle them.

---

## When to stop and ask for review

Stop and ask before committing if:
- TMDB identity was not fully confident
- `sync:tmdb` reported a behavior-impacting change you do not understand
- `pnpm test` or `pnpm build` fails
- `git diff --check` fails
- the movie’s taste, mood, or spread feels uncertain
- the addition seems to push the catalogue toward one mood/situation/region without a clear balance reason
- the generated factual snapshot looks wrong in any material way

Also stop and review if adding the movie would make the catalogue less coherent, not more.

---

## Lessons from the Rye Lane circular sync bug

The Rye Lane sync problem happened because the three catalogue layers were not reconciled before the attempt to commit.

What actually happened:

1. Rye Lane was added to `src/data/curatedMovies.ts`.
2. A matching mapping was added to `src/data/tmdbMovieMappings.json`.
3. `pnpm sync:tmdb` was run to refresh `src/data/generated/tmdbMovies.json`.
4. The TMDB record for Rye Lane has `posterPath` as null, and null posters remained in the snapshot under the old convention as the string `"null"`.
5. The generated snapshot then failed validation because the new schema required either a real poster path or a properly normalized null, and the existing snapshot file did not satisfy that.
6. The build could not reconcile the intended mapping with the generated facts, so the new movie could not be added without also fixing the generated factual snapshot.

The practical lesson is not that TMDB and Movie Mood are magically circular. The lesson is narrower and more useful:

- do not assume a TMDB record will arrive in the shape you expect
- do not add a curated entry and a mapping and then sync without checking what shape the generated facts will take
- if a new factual field can be missing or null, make sure both the sync and the generated snapshot handle that shape the same way before you commit
- after sync, always verify the new movie is present in `generated/tmdbMovies.json`
- after sync, always verify the `id` and `tmdbId` match across all three files
- when sync fails or the snapshot looks wrong, stop and fix the factual layer, not the curated layer alone
- do not force a commit to “unblock” the catalogue if the generated snapshot is stale, wrong, or failing validation

The meta lesson stays the same: Movie Mood owns meaning, TMDB owns facts, and the two must be reconciled before anything is committed.

---

## Minimal safe checklist

Before a commit, be able to say yes to all of these:

- [ ] TMDB identity verified
- [ ] `src/data/curatedMovies.ts` has the full `CuratedMovie` object
- [ ] `src/data/tmdbMovieMappings.json` has the mapping
- [ ] `TMDB_READ_ACCESS_TOKEN` available
- [ ] `pnpm sync:tmdb` run and snapshot refreshed
- [ ] new movie present in `generated/tmdbMovies.json`
- [ ] `id` and `tmdbId` match across all three files
- [ ] `pnpm test` passed
- [ ] `pnpm build` passed
- [ ] `git diff --check` passed
- [ ] `docs/curation-drafts/` not staged
- [ ] only the right data files staged
- [ ] one movie per commit, unless there is a clear reason not to

If any item is not yes, stop and fix it or ask for review.
