import { useState, useRef, useEffect } from 'react'

/**
 * FeatureTooltip - Renders a sleek, luxurious floating info popover
 * whenever the user's cursor hovers over the wrapped children.
 */
export function FeatureTooltip({
  feature,
  title,
  badge,
  icon,
  summary,
  highlights,
  metric,
  tip,
  position = 'right',
  delay = 120,
  children,
  className = '',
  width = 320,
}) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef(null)

  // Allow passing either a feature object or individual props
  const feat = feature || {}
  const cardTitle = title || feat.title
  const cardBadge = badge || feat.badge
  const cardIcon = icon || feat.icon
  const cardSummary = summary || feat.summary || feat.description
  const cardHighlights = highlights || feat.highlights
  const cardMetric = metric || feat.metric
  const cardTip = tip || feat.tip

  const handleMouseEnter = () => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setVisible(true)
    }, delay)
  }

  const handleMouseLeave = () => {
    clearTimeout(timerRef.current)
    setVisible(false)
  }

  useEffect(() => {
    return () => clearTimeout(timerRef.current)
  }, [])

  if (!cardTitle && !cardSummary) {
    return children
  }

  return (
    <div
      className={`feature-tooltip-wrapper ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
    >
      {children}
      {visible && (
        <div
          className={`feature-hover-popover pos-${position}`}
          style={{ width: `${width}px` }}
          role="tooltip"
          aria-hidden={!visible}
        >
          <div className="fhp-arrow" />
          
          <div className="fhp-header">
            {cardIcon && (
              <span className="fhp-icon">
                <i className={`bi bi-${cardIcon}`} />
              </span>
            )}
            <div className="fhp-titles">
              <div className="fhp-title-row">
                <h4 className="fhp-title">{cardTitle}</h4>
                {cardBadge && <span className="fhp-badge">{cardBadge}</span>}
              </div>
            </div>
          </div>

          {cardSummary && <p className="fhp-summary">{cardSummary}</p>}

          {cardHighlights && cardHighlights.length > 0 && (
            <ul className="fhp-highlights">
              {cardHighlights.map((item, idx) => (
                <li key={idx}>
                  <i className="bi bi-check2-circle" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}

          {(cardMetric || cardTip) && (
            <div className="fhp-footer">
              {cardMetric && (
                <div className="fhp-metric">
                  <i className="bi bi-lightning-charge-fill" />
                  <span>{cardMetric}</span>
                </div>
              )}
              {cardTip && (
                <div className="fhp-tip">
                  <i className="bi bi-lightbulb" />
                  <span><strong>Tip:</strong> {cardTip}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * FeatureInfoBadge - An interactive pill / icon you can put next to any label
 * that reveals feature details when the cursor points on it.
 */
export function FeatureInfoBadge({ feature, label, position = 'top' }) {
  return (
    <FeatureTooltip feature={feature} position={position} width={280}>
      <span className="feature-info-badge" tabIndex={0} role="button" aria-label="Feature info">
        {label && <span className="fib-label">{label}</span>}
        <i className="bi bi-info-circle-fill" />
      </span>
    </FeatureTooltip>
  )
}

export default FeatureTooltip
