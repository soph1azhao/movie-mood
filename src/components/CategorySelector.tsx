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
  const activeMood = moods.find((mood) => mood.id === selectedMood)

  return (
    <div>
      <div className="mood-line" aria-label="Choose a movie mood">
        {moods.map((mood) => {
          const isSelected = selectedMood === mood.id
          return (
            <span className={`mood-item ${isSelected ? 'is-selected' : ''}`} key={mood.id}>
              <button
                className="mood-btn"
                type="button"
                aria-label={`${mood.label} ${mood.note}`}
                aria-pressed={isSelected}
                onClick={() => onSelect(mood.id)}
              >
                {mood.label}
              </button>
            </span>
          )
        })}
      </div>
      {activeMood && (
        <p className="mood-selected-note">
          Tonight leans {activeMood.label.toLowerCase()} — {activeMood.note.toLowerCase()}.
        </p>
      )}
    </div>
  )
}
