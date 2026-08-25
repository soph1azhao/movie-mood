# Movie Mood learning notes

This is a small React and TypeScript app. The main pieces fit together like this:

```text
index.html → src/main.tsx → src/App.tsx
```

## How the app starts

- `index.html` is the browser entry point. It provides the `<div id="root">` container and loads `src/main.tsx`.
- `src/main.tsx` creates a React root, imports the global CSS, and renders `<App />` inside React `StrictMode`.
- `src/App.tsx` owns the page flow and state. It renders the header, mood selector, recommendation grid, and footer.

## How mood selection works

`src/components/CategorySelector.tsx` defines the six available moods and renders one button for each. When a button is clicked, it calls the `onSelect` function supplied by `App`.

`App` stores the selected mood in `selectedMood`. It filters the movie list to movies whose `moods` array includes that mood, then shows three matches. Choosing a different mood resets the recommendation round and scrolls to the results.

The **Another three** button increases the `round` value. `App` uses that value as an offset, so the next three matching movies are shown. The list wraps around when it reaches the end.

## Where movie data lives

The recommendations are in `src/data/movies.ts`. Each item follows the `Movie` type in `src/types/movie.ts`, including its title, year, director, genres, description, moods, reason to watch, and two poster colors.

## How `MovieCard` displays one recommendation

`src/components/MovieCard.tsx` receives one `Movie` object and its position in the list. It creates a CSS-generated title poster from the movie’s title, year, symbol, and `palette` colors. It then displays the title, director, genres, description, and `whyWatch` text. `MovieGrid` maps the three selected movies into three `MovieCard` components.

## How GitHub Pages deployment works

The workflow in `.github/workflows/deploy.yml` runs when changes are pushed to `main` or when it is started manually:

1. GitHub checks out the repository.
2. The workflow sets up pnpm 11 and Node 24.
3. It installs the locked dependencies and runs the Vite build.
4. It uploads the `dist` folder as a Pages artifact.
5. A second job deploys that artifact to GitHub Pages.

The repository’s Pages source must be set to **GitHub Actions** in **Settings → Pages**. Vite uses a relative asset base so the built files work at the project URL.

## How to add a new movie

1. Open `src/data/movies.ts`.
2. Add another object to the `movies` array with every field required by the `Movie` type.
3. Give it a unique `id` and add one or more valid mood IDs to `moods`.
4. Choose two CSS color values for the `palette` tuple.
5. Run `pnpm run build` to check the change.

## How to add a new mood

1. Add the new mood ID to the `Mood` union in `src/types/movie.ts`.
2. Add its label, icon, and short note to the `moods` array in `src/components/CategorySelector.tsx`.
3. Add that mood ID to the `moods` array of any matching movies in `src/data/movies.ts`.
4. Run `pnpm run build` and try the new button locally.
