import type { Mood } from '../types/movie'

export const moods: { id: Mood; label: string; icon: string; note: string }[] = [
  { id: 'funny', label: 'Funny', icon: '✦', note: 'A little lighter' },
  { id: 'exciting', label: 'Exciting', icon: '↗', note: 'Turn it up' },
  { id: 'thoughtful', label: 'Thought-provoking', icon: '◌', note: 'For the curious' },
  { id: 'relaxing', label: 'Relaxing', icon: '☾', note: 'Ease into it' },
  { id: 'emotional', label: 'Emotional', icon: '♡', note: 'Feel something' },
  { id: 'suspenseful', label: 'Suspenseful', icon: '◒', note: 'Keep you guessing' },
]

interface CategorySelectorProps {
  selectedMood: Mood | null
  onSelect: (mood: Mood) => void
}

export function CategorySelector({ selectedMood, onSelect }: CategorySelectorProps) {
  return (
    <div className="mood-grid" aria-label="Choose a movie mood">
      {moods.map((mood) => {
        const isSelected = selectedMood === mood.id
        return (
          <button
            className={`mood-button ${isSelected ? 'is-selected' : ''}`}
            type="button"
            aria-pressed={isSelected}
            key={mood.id}
            onClick={() => onSelect(mood.id)}
          >
            <span className="mood-icon" aria-hidden="true">{mood.icon}</span>
            <span>
              <span className="mood-label">{mood.label}</span>
              <span className="mood-note">{mood.note}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
