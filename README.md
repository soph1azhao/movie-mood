# Movie Mood

A small, cinematic movie-discovery site for the question: **what should I watch tonight?** Choose a feeling and Movie Mood gives you three carefully selected films, along with a concise reason each one fits the moment.

## Live demo

After GitHub Pages is enabled, the site will be available at `https://YOUR-USERNAME.github.io/movie-mood/`.

## Screenshot

Run the site locally and add a screenshot here whenever you’re ready.

## Features

- Six mood-first ways to browse: funny, exciting, thought-provoking, relaxing, emotional, and suspenseful.
- Three focused recommendations at a time — no endless catalogue to sift through.
- “Another three” rotates through more matching films without immediately repeating a pick.
- A local, TypeScript-typed collection of 26 films spanning decades, countries, directors, and genres.
- Responsive, keyboard-friendly single-page interface with an intentional initial state.
- Custom title posters created in CSS, so there are no fragile external image links or API keys.

## Tech stack

- React
- TypeScript
- Vite
- Plain CSS
- GitHub Pages + GitHub Actions

## Run locally

```bash
git clone https://github.com/YOUR-USERNAME/movie-mood.git
cd movie-mood
npm install
npm run dev
```

Vite will print a local URL, normally `http://localhost:5173`.

`npm` works as shown above; if you prefer pnpm, this repository also includes a pnpm lockfile, so use `pnpm install` and `pnpm dev`.

## Build

```bash
npm run build
npm run preview
```

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and publishes the site whenever changes are pushed to `main`.

1. Push this repository to GitHub.
2. Open **Settings → Pages** in the GitHub repository.
3. Under **Build and deployment**, set the source to **GitHub Actions**.
4. Push to `main` (or run the workflow manually from the Actions tab).

Vite is configured with a relative asset base, so the built site works at either a repository URL such as `/movie-mood/` or a custom project path.

## Project structure

```text
src/
├── components/    # Small visual building blocks
├── data/movies.ts # Local movie collection and metadata
├── types/         # Shared TypeScript types
├── App.tsx        # Page state and recommendation selection
└── styles.css     # The responsive visual system
.github/workflows/ # GitHub Pages deployment
```

## Future ideas

- Browse by director, country, and cultural context
- Theme-based recommendations
- TMDb integration for posters and expanded details
- Favorites and a personal taste profile
- Conversational AI recommendations

## What I learned

_Add your own notes here as you explore the project — for example, how React state changes the recommendations, how the data file is structured, or how a GitHub Actions deployment works._
