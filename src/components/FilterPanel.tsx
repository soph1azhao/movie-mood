import type { EmotionalWeight, MovieFilters, Pace, RuntimeFilter } from '../types/movie'

interface FilterPanelProps {
  filters: MovieFilters
  genreOptions: string[]
  languageOptions: string[]
  onChange: (filters: MovieFilters) => void
  onClear: () => void
}

const runtimeOptions: { id: RuntimeFilter; label: string }[] = [
  { id: 'short', label: 'Under 100 min' },
  { id: 'medium', label: '100-130 min' },
  { id: 'long', label: 'Over 130 min' },
]

const paceOptions: { id: Pace; label: string }[] = [
  { id: 'slow', label: 'Slow' },
  { id: 'medium', label: 'Medium' },
  { id: 'fast', label: 'Fast' },
]

const emotionalWeightOptions: { id: EmotionalWeight; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'moderate', label: 'Moderate' },
  { id: 'heavy', label: 'Heavy' },
]

function hasActiveFilters(filters: MovieFilters) {
  return (
    filters.genres.length > 0
    || filters.runtime !== null
    || filters.language !== null
    || filters.pace !== null
    || filters.emotionalWeight !== null
  )
}

export function FilterPanel({ filters, genreOptions, languageOptions, onChange, onClear }: FilterPanelProps) {
  const activeFilters = hasActiveFilters(filters)

  function toggleGenre(genre: string) {
    const genres = filters.genres.includes(genre)
      ? filters.genres.filter((currentGenre) => currentGenre !== genre)
      : [...filters.genres, genre]

    onChange({ ...filters, genres })
  }

  function toggleSingleFilter<Key extends 'runtime' | 'language' | 'pace' | 'emotionalWeight'>(
    key: Key,
    value: MovieFilters[Key],
  ) {
    onChange({
      ...filters,
      [key]: filters[key] === value ? null : value,
    })
  }

  return (
    <details className="filter-panel" open={activeFilters}>
      <summary className="filter-heading">
        <div>
          <p className="eyebrow">Get specific</p>
          <h3 id="filter-heading">Narrow the shortlist</h3>
        </div>
        <span className="summary-hint" aria-hidden="true">{activeFilters ? 'Open' : 'Optional'}</span>
      </summary>
      <div className="filter-toolbar">
        <button type="button" className="clear-filters" onClick={onClear} disabled={!activeFilters}>
          Clear filters
        </button>
      </div>

      <div className="filter-groups">
        <div className="filter-group">
          <p className="refine-label">Genre</p>
          <div className="refine-row">
            {genreOptions.map((genre) => {
              const isSelected = filters.genres.includes(genre)
              return (
                <button
                  type="button"
                  className={`word-chip ${isSelected ? 'is-selected' : ''}`}
                  aria-pressed={isSelected}
                  key={genre}
                  onClick={() => toggleGenre(genre)}
                >
                  {genre}
                </button>
              )
            })}
          </div>
        </div>

        <div className="filter-group">
          <p className="refine-label">Runtime</p>
          <div className="refine-row">
            {runtimeOptions.map((runtime) => {
              const isSelected = filters.runtime === runtime.id
              return (
                <button
                  type="button"
                  className={`word-chip ${isSelected ? 'is-selected' : ''}`}
                  aria-pressed={isSelected}
                  key={runtime.id}
                  onClick={() => toggleSingleFilter('runtime', runtime.id)}
                >
                  {runtime.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="filter-group">
          <p className="refine-label">Language</p>
          <div className="refine-row">
            {languageOptions.map((language) => {
              const isSelected = filters.language === language
              return (
                <button
                  type="button"
                  className={`word-chip ${isSelected ? 'is-selected' : ''}`}
                  aria-pressed={isSelected}
                  key={language}
                  onClick={() => toggleSingleFilter('language', language)}
                >
                  {language}
                </button>
              )
            })}
          </div>
        </div>

        <div className="filter-group">
          <p className="refine-label">Pace</p>
          <div className="refine-row">
            {paceOptions.map((pace) => {
              const isSelected = filters.pace === pace.id
              return (
                <button
                  type="button"
                  className={`word-chip ${isSelected ? 'is-selected' : ''}`}
                  aria-pressed={isSelected}
                  key={pace.id}
                  onClick={() => toggleSingleFilter('pace', pace.id)}
                >
                  {pace.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="filter-group">
          <p className="refine-label">Emotional weight</p>
          <div className="refine-row">
            {emotionalWeightOptions.map((emotionalWeight) => {
              const isSelected = filters.emotionalWeight === emotionalWeight.id
              return (
                <button
                  type="button"
                  className={`word-chip ${isSelected ? 'is-selected' : ''}`}
                  aria-pressed={isSelected}
                  key={emotionalWeight.id}
                  onClick={() => toggleSingleFilter('emotionalWeight', emotionalWeight.id)}
                >
                  {emotionalWeight.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </details>
  )
}
