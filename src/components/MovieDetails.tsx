import type { Movie } from '../types/movie'

interface MovieDetailsProps {
  movie: Movie
}

const moodLabels: Record<Movie['moods'][number], string> = {
  funny: 'Funny',
  exciting: 'Exciting',
  thoughtful: 'Thought-provoking',
  relaxing: 'Relaxing',
  emotional: 'Emotional',
  suspenseful: 'Suspenseful',
}

const situationLabels: Record<Movie['situations'][number], string> = {
  alone: 'Quiet night alone',
  'date-night': 'Date night',
  friends: 'With friends',
  family: 'Family movie night',
  'easy-watch': 'Don’t want to think too hard',
}

const attentionDemandLabels: Record<Movie['attentionDemand'], string> = {
  easy: 'Take it easy',
  engaged: 'Keep me engaged',
  immersive: 'Full immersion',
}

const discoveryStyleLabels: Record<Movie['discoveryStyle'], string> = {
  familiar: 'Keep it familiar',
  different: 'Something different',
  adventurous: 'Surprise me',
}

export function MovieDetails({ movie }: MovieDetailsProps) {
  return (
    <>
      <div className="details-copy">
        <p className="why-label">Description</p>
        <p>{movie.description}</p>
      </div>
      <dl className="details-list">
        <div>
          <dt>Title</dt>
          <dd>{movie.title}</dd>
        </div>
        <div>
          <dt>Year</dt>
          <dd>{movie.year}</dd>
        </div>
        <div>
          <dt>Director</dt>
          <dd>{movie.director}</dd>
        </div>
        <div>
          <dt>Countries</dt>
          <dd>{movie.countries.join(', ')}</dd>
        </div>
        <div>
          <dt>Viewing languages</dt>
          <dd>{movie.languages.join(', ')}</dd>
        </div>
        <div>
          <dt>Spoken languages</dt>
          <dd>{movie.spokenLanguages.join(', ')}</dd>
        </div>
        <div>
          <dt>Genres</dt>
          <dd>{movie.genres.join(', ')}</dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd>{movie.runtimeMinutes} min</dd>
        </div>
        <div>
          <dt>Moods</dt>
          <dd>{movie.moods.map((mood) => moodLabels[mood]).join(', ')}</dd>
        </div>
        <div>
          <dt>Situations</dt>
          <dd>{movie.situations.map((situation) => situationLabels[situation]).join(', ')}</dd>
        </div>
        <div>
          <dt>Pace</dt>
          <dd>{movie.pace}</dd>
        </div>
        <div>
          <dt>Emotional weight</dt>
          <dd>{movie.emotionalWeight}</dd>
        </div>
        <div>
          <dt>Attention demand</dt>
          <dd>{attentionDemandLabels[movie.attentionDemand]}</dd>
        </div>
        <div>
          <dt>Discovery style</dt>
          <dd>{discoveryStyleLabels[movie.discoveryStyle]}</dd>
        </div>
        <div>
          <dt>Curiosity hook</dt>
          <dd>{movie.curiosityHook}</dd>
        </div>
        <div>
          <dt>Vibe summary</dt>
          <dd>{movie.vibeSummary}</dd>
        </div>
        <div>
          <dt>Why watch</dt>
          <dd>{movie.whyWatch}</dd>
        </div>
      </dl>
    </>
  )
}
