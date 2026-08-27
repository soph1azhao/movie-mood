import type { AttentionDemand, DiscoveryPreferences, DiscoveryStyle } from '../types/movie'

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

const discoveryOptions: { id: DiscoveryStyle; label: string }[] = [
  { id: 'familiar', label: 'Keep it familiar' },
  { id: 'different', label: 'Something different' },
  { id: 'adventurous', label: 'Surprise me' },
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

  function selectDiscoveryStyle(discoveryStyle: DiscoveryStyle) {
    onChange({
      ...preferences,
      discoveryStyle: preferences.discoveryStyle === discoveryStyle ? null : discoveryStyle,
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
      <div className="discovery-heading">
        <div>
          <p className="eyebrow">Optional</p>
          <h3 id="discovery-heading">What feels right tonight?</h3>
        </div>
        <button type="button" className="clear-filters" onClick={onClear} disabled={!activePreferences}>
          Clear tonight
        </button>
      </div>

      <div className="discovery-groups">
        <div className="filter-group">
          <p className="filter-label">Attention</p>
          <div className="filter-options">
            {attentionOptions.map((option) => {
              const isSelected = preferences.attentionDemand === option.id
              return (
                <button
                  type="button"
                  className={`filter-chip ${isSelected ? 'is-selected' : ''}`}
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
          <p className="filter-label">Discovery</p>
          <div className="filter-options">
            {discoveryOptions.map((option) => {
              const isSelected = preferences.discoveryStyle === option.id
              return (
                <button
                  type="button"
                  className={`filter-chip ${isSelected ? 'is-selected' : ''}`}
                  aria-pressed={isSelected}
                  key={option.id}
                  onClick={() => selectDiscoveryStyle(option.id)}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="filter-group">
          <p className="filter-label">Not tonight</p>
          <div className="filter-options">
            {dealbreakerOptions.map((option) => {
              const isSelected = preferences.dealbreakers[option.id]
              return (
                <button
                  type="button"
                  className={`filter-chip ${isSelected ? 'is-selected' : ''}`}
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
