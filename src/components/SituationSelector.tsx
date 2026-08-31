import type { ViewingSituation } from '../types/movie'

interface SituationOption {
  id: ViewingSituation | null
  label: string
  note: string
}

const situations: SituationOption[] = [
  { id: null, label: 'No preference', note: 'Keep it mood-based' },
  { id: 'alone', label: 'Quiet night alone', note: 'Introspective picks' },
  { id: 'date-night', label: 'Date night', note: 'Good to share' },
  { id: 'friends', label: 'With friends', note: 'Group-watch energy' },
  { id: 'family', label: 'Family movie night', note: 'Broadly approachable' },
  { id: 'easy-watch', label: 'Don’t want to think too hard', note: 'Lower-lift viewing' },
]

interface SituationSelectorProps {
  selectedSituation: ViewingSituation | null
  onSelect: (situation: ViewingSituation | null) => void
}

export function SituationSelector({ selectedSituation, onSelect }: SituationSelectorProps) {
  return (
    <div className="situation-panel refine-group" aria-label="What's tonight like?">
      <p className="refine-label">Tonight is</p>
      <div className="refine-row">
        {situations.map((situation) => {
          const isSelected = selectedSituation === situation.id
          return (
            <button
              type="button"
              className={`word-chip ${isSelected ? 'is-selected' : ''}`}
              aria-label={`${situation.label} ${situation.note}`}
              aria-pressed={isSelected}
              key={situation.label}
              onClick={() => onSelect(situation.id)}
            >
              {situation.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
