import { useId } from 'react'
import { scores } from './model'
import type { Records } from './model'

export type Metric = 'audio' | 'visual' | 'combined'
export default function Chart({
  records,
  metric = 'combined',
  compact = false,
}: {
  records: Records
  metric?: Metric
  compact?: boolean
}) {
  const id = useId()
  const x = (day: number) => 32 + (day - 1) * (640 / 41)
  const y = (score: number) => 158 - (score - 1) * 33
  const series = [false, true].map((ai) =>
    Array.from({ length: 42 }, (_, i) => ({
      day: i + 1,
      value: scores(records[i + 1], ai)[metric],
    })),
  )
  const any = series.some((s) => s.some((p) => p.value !== null))
  return (
    <div className={`chart-wrap ${compact ? 'compact-chart' : ''}`}>
      <svg viewBox="0 0 700 195" role="img" aria-labelledby={id}>
        <title id={id}>
          {metric} self and AI scores over 42 days. Missing assessments are gaps.
        </title>
        {[1, 2, 3, 4, 5].map((n) => (
          <g key={n}>
            <line
              x1="32"
              x2="672"
              y1={y(n)}
              y2={y(n)}
              stroke="var(--border)"
              strokeDasharray="3 5"
            />
            <text x="9" y={y(n) + 4} fill="var(--muted)" fontSize="11">
              {n}
            </text>
          </g>
        ))}
        {[1, 7, 14, 21, 28, 35, 42].map((d) => (
          <text key={d} x={x(d)} y="184" textAnchor="middle" fill="var(--muted)" fontSize="10">
            {compact ? d : `Day ${d}`}
          </text>
        ))}
        {series.map((points, index) => (
          <g key={index}>
            {points.map((p, i) =>
              p.value !== null && i > 0 && points[i - 1].value !== null ? (
                <line
                  key={`l${p.day}`}
                  x1={x(points[i - 1].day)}
                  y1={y(points[i - 1].value!)}
                  x2={x(p.day)}
                  y2={y(p.value)}
                  stroke={index ? 'var(--mint)' : 'var(--accent)'}
                  strokeWidth="2.5"
                />
              ) : null,
            )}
            {points
              .filter((p) => p.value !== null)
              .map((p) => (
                <circle
                  key={p.day}
                  cx={x(p.day)}
                  cy={y(p.value!)}
                  r="4"
                  fill={index ? 'var(--mint)' : 'var(--accent)'}
                  stroke="var(--surface)"
                  strokeWidth="1.5"
                >
                  <title>
                    Day {p.day}: {index ? 'AI' : 'Self'} {p.value!.toFixed(2)}/5
                  </title>
                </circle>
              ))}
          </g>
        ))}
        {!any && (
          <text x="352" y="96" textAnchor="middle" fill="var(--muted)" fontSize="13">
            Your first review starts the story.
          </text>
        )}
      </svg>
      <div className="chart-legend">
        <span>
          <i className="dot purple" />
          Self review
        </span>
        <span>
          <i className="dot mint" />
          AI review
        </span>
        <span className="legend-note">Out of 5 · gaps are unrated days</span>
      </div>
    </div>
  )
}
