import type { AttentionDemand, DiscoveryPreferences } from '../types/movie'

interface DiscoveryPreferencesPanelProps {
  preferences: DiscoveryPreferences
  onChange: (preferences: DiscoveryPreferences) => void
  onClear: () => void
}

const attentionOptions: { id: AttentionDemand; label: string }[] = [
  { id: 'easy', label: 'Take it easy' },
  { id: 'engaged', label: 'Keep me engaged' },
  { id: 'immersive', label: 'Full immersion' },
]

const dealbreakerOptions: { id: keyof DiscoveryPreferences['dealbreakers']; label: string }[] = [
  { id: 'avoidHeavy', label: 'Nothing emotionally heavy' },
  { id: 'avoidSlow', label: 'No slow burn' },
  { id: 'underTwoHours', label: 'Keep it under 2 hours' },
]

function hasActivePreferences(preferences: DiscoveryPreferences) {
  return (
    preferences.attentionDemand !== null
    || preferences.discoveryStyle !== null
    || Object.values(preferences.dealbreakers).some(Boolean)
  )
}

export function DiscoveryPreferencesPanel({
  preferences,
  onChange,
  onClear,
}: DiscoveryPreferencesPanelProps) {
  const activePreferences = hasActivePreferences(preferences)

  function selectAttention(attentionDemand: AttentionDemand) {
    onChange({
      ...preferences,
      attentionDemand: preferences.attentionDemand === attentionDemand ? null : attentionDemand,
    })
  }

  function toggleDealbreaker(dealbreaker: keyof DiscoveryPreferences['dealbreakers']) {
    onChange({
      ...preferences,
      dealbreakers: {
        ...preferences.dealbreakers,
        [dealbreaker]: !preferences.dealbreakers[dealbreaker],
      },
    })
  }

  return (
    <section className="discovery-panel" aria-labelledby="discovery-heading">
      <div className="discovery-heading refine-heading">
        <div>
          <p className="eyebrow">Getting warmer?</p>
          <h3 id="discovery-heading">Tell me a little more.</h3>
        </div>
        <button type="button" className="clear-filters" onClick={onClear} disabled={!activePreferences}>
          Clear tonight
        </button>
      </div>

      <div className="discovery-groups">
        <div className="filter-group">
          <p className="refine-label">How much focus do you have?</p>
          <div className="refine-row">
            {attentionOptions.map((option) => {
              const isSelected = preferences.attentionDemand === option.id
              return (
                <button
                  type="button"
                  className={`word-chip ${isSelected ? 'is-selected' : ''}`}
                  aria-pressed={isSelected}
                  key={option.id}
                  onClick={() => selectAttention(option.id)}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="filter-group">
          <p className="refine-label">Not tonight</p>
          <div className="refine-row">
            {dealbreakerOptions.map((option) => {
              const isSelected = preferences.dealbreakers[option.id]
              return (
                <button
                  type="button"
                  className={`word-chip ${isSelected ? 'is-selected' : ''}`}
                  aria-pressed={isSelected}
                  key={option.id}
                  onClick={() => toggleDealbreaker(option.id)}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
