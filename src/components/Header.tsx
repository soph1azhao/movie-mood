export function Header() {
  return (
    <header className="site-header">
      <a className="brand" href="#top" aria-label="Movie Mood home">
        <span className="brand-mark" aria-hidden="true">◐</span>
        Movie Mood
      </a>
      <a
        className="github-link"
        href="https://github.com/"
        target="_blank"
        rel="noreferrer"
      >
        GitHub <span aria-hidden="true">↗</span>
      </a>
    </header>
  )
}
