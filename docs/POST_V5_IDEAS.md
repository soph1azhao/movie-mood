# Movie Mood — Post-V5 Exploration Ideas

> **Status: non-normative.**
>
> These are exploration ideas for possible future work. They are not acceptance criteria for V5 or any current version. Agents must not implement these ideas unless a future version specification explicitly promotes them into scope.

Movie Mood does not require another version merely because these ideas exist. They should be considered only when there is a clear product reason.

## Where to Watch

Explore country-specific streaming/provider availability.

This is especially relevant after Movie Mood helps the user make a final choice:

```text
Tonight's Pick
      ↓
Where can I watch it?
```

Provider information is volatile and regional and may carry separate attribution requirements, so it should not be mixed into V5's stable factual snapshot without a separate design review.

---

## Automated Metadata Refresh

A future workflow could periodically refresh TMDB metadata.

Possible model:

```text
scheduled GitHub Action
        ↓
TMDB refresh
        ↓
generated diff
        ↓
reviewable pull request
```

Do not auto-deploy factual changes without review.

Manual synchronization remains more appropriate while Movie Mood has a small curated catalogue.

---

## TMDB Change Tracking

Investigate TMDB's change-tracking capabilities if full-catalogue synchronization ever becomes inefficient.

This could allow selective refreshes rather than re-fetching every curated movie.

It is unnecessary for the current small catalogue.

---

## Larger Curated Catalogue

TMDB removes much of the manual burden of maintaining factual movie metadata.

That could make it technically easy to grow Movie Mood from dozens of movies toward hundreds.

The limiting problem would then become:

> How do we preserve the quality and consistency of Movie Mood's human meaning layer?

Catalogue growth should not happen merely because factual data is easy to import.

---

## Curation Tooling

A future maintainer tool could help add one movie by:

1. searching TMDB
2. presenting candidate matches
3. requiring explicit human selection
4. importing factual metadata
5. scaffolding blank Movie Mood editorial fields
6. validating the completed annotation

The tool should assist curation.

It must not automatically decide what a movie means.

---

## Curated-Catalogue Search

If the Movie Mood catalogue grows significantly, add search across movies already curated by Movie Mood.

This differs from universal TMDB search because every result would still possess the complete Movie Mood meaning layer.

---

## Universal TMDB Search / Request a Movie

A later experiment could let users look up arbitrary TMDB movies.

The unresolved product problem is that arbitrary TMDB records have:

```text
facts
```

but not:

```text
Movie Mood meaning
```

Do not treat unannotated TMDB movies as equivalent to curated Movie Mood movies.

---

## Annotation at Scale

If the catalogue grows, investigate better curation workflows:

* editorial guidelines
* review/checking tools
* consistency checks
* annotation queues
* assisted drafts
* human approval workflows

AI-assisted drafts could potentially help a maintainer, but generated annotations must never silently become authoritative Movie Mood metadata.

---

## Additional Experience Dimensions

Previously discussed possibilities include:

```text
hook speed
visual tone
payoff style
```

Only introduce a new subjective field if actual product use demonstrates that the existing model cannot express an important decision dimension.

Do not add taxonomies simply because they sound interesting.

---

## Richer TMDB Details

Potential future factual enrichment includes:

* selected cast
* backdrop imagery
* original titles
* richer release information
* additional credits
* TMDB overview

Each field should be added only when it materially improves the Movie Mood decision experience.

Movie Mood should not become an IMDb-style information page.

---

## Local Poster Caching / Self-Hosted Images

A future version could investigate storing poster assets locally for stronger resilience or offline behavior.

Before doing so, review:

* image rights/terms
* attribution
* storage growth
* repository size
* refresh behavior
* GitHub Pages constraints

V5 intentionally keeps remote TMDB image delivery with a local visual fallback.

---

## TMDB Accounts and Cloud Watchlists

TMDB supports user authentication and account-level functionality.

Possible capabilities include:

* ratings
* favourites
* watchlists

These conflict with Movie Mood's current account-free, browser-local architecture and should require a separate product decision.

---

## External Ratings / Popularity

TMDB provides popularity and vote information.

Do not use these merely because they are available.

A future version should use external popularity/rating signals only if there is a clearly defined human decision problem they solve.

They should never silently replace Movie Mood's curated recommendation logic.

---

## TV Support

The factual-data architecture could potentially support television records later.

TV introduces different concepts:

* seasons
* episodes
* ongoing status
* substantially different runtime semantics

It should be treated as a separate product expansion rather than folded into the movie model casually.

---

## Commercialization / Licensing Review

The current project is designed as a non-commercial toy/learning project.

If Movie Mood later becomes revenue-generating or otherwise commercial, review:

* TMDB licensing
* image/data rights
* attribution obligations
* infrastructure needs

before treating the existing developer API arrangement as sufficient.

---

## Product Principle for Future Work

Any future idea should continue to pass this test:

> **Does this help someone stop browsing and choose a movie that feels right tonight?**

Technical possibility alone is not enough reason to expand Movie Mood.
