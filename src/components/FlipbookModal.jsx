import { useState, useEffect } from 'react'
import { FeatureTooltip } from './ui'

const sampleSpreads = [
  {
    spreadNum: 1,
    title: 'The Royal Baraat & Procession',
    leftImg: 'https://images.unsplash.com/photo-1583939003579-730e3918a45a?auto=format&fit=crop&w=1000&q=80',
    rightImg: 'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1000&q=80',
    leftNote: 'Traditional dhol & dancing entrance',
    rightNote: 'Groom arrival with floral garlands',
    comment: 'Priya (Bride): "Love this full bleed photo! Can we brighten the background fairy lights?"',
    status: 'In Review'
  },
  {
    spreadNum: 2,
    title: 'Varmala & Sacred Mantras',
    leftImg: 'https://images.unsplash.com/photo-1606800052052-a08af7148866?auto=format&fit=crop&w=1000&q=80',
    rightImg: 'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=1000&q=80',
    leftNote: 'The exchange of rose garlands',
    rightNote: 'Mandap sacred fire ceremony',
    comment: 'Karthik (Groom): "Perfect shot! Layout approved without any changes."',
    status: 'Approved'
  },
  {
    spreadNum: 3,
    title: 'Sindoor Daan & Saptapadi',
    leftImg: 'https://images.unsplash.com/photo-1532712938310-34cb3982ef74?auto=format&fit=crop&w=1000&q=80',
    rightImg: 'https://images.unsplash.com/photo-1465495976277-4387d4b0b4c6?auto=format&fit=crop&w=1000&q=80',
    leftNote: 'Seven sacred steps around agni',
    rightNote: 'Candid laughter during vows',
    comment: null,
    status: 'Pending Review'
  },
  {
    spreadNum: 4,
    title: 'Bridal Portraits & Sunset Radiance',
    leftImg: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=1000&q=80',
    rightImg: 'https://images.unsplash.com/photo-1519225429815-5858022934ff?auto=format&fit=crop&w=1000&q=80',
    leftNote: 'Detailed heirloom jewelry close-up',
    rightNote: 'Golden hour silhouette at poolside',
    comment: 'Priya (Bride): "Our absolute favorite spread of the whole album! ❤️"',
    status: 'Approved'
  }
]

export function FlipbookModal({ album, isOpen, onClose }) {
  const [currentIdx, setCurrentIdx] = useState(0)
  const [showNotes, setShowNotes] = useState(true)
  const [isZoomed, setIsZoomed] = useState(false)
  const [approvedSpreads, setApprovedSpreads] = useState({})

  const spread = sampleSpreads[currentIdx]

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, currentIdx])

  if (!isOpen || !album) return null

  const next = () => {
    if (currentIdx < sampleSpreads.length - 1) setCurrentIdx((i) => i + 1)
  }

  const prev = () => {
    if (currentIdx > 0) setCurrentIdx((i) => i - 1)
  }

  const toggleApprove = () => {
    setApprovedSpreads((prev) => ({
      ...prev,
      [currentIdx]: !prev[currentIdx]
    }))
  }

  const isApproved = approvedSpreads[currentIdx] || spread.status === 'Approved'

  return (
    <div className="flipbook-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="flipbook-container" onClick={(e) => e.stopPropagation()}>
        {/* Top bar controls */}
        <header className="flipbook-header">
          <div className="flipbook-title-group">
            <span className="flipbook-badge">3D Virtual Flipbook</span>
            <h2>{album.title} — {spread.title}</h2>
            <p className="flipbook-subtitle">
              Spread {currentIdx + 1} of {sampleSpreads.length} · {album.photos} Curated Photos
            </p>
          </div>

          <div className="flipbook-actions">
            <FeatureTooltip
              title="Toggle Client Annotations"
              summary="Show or hide feedback sticky notes left by the couple."
              position="bottom"
              width={240}
            >
              <button
                className={`btn btn-sm ${showNotes ? 'btn-gold' : 'btn-ghost'}`}
                onClick={() => setShowNotes(!showNotes)}
              >
                <i className={`bi bi-${showNotes ? 'chat-quote-fill' : 'chat-quote'}`} />
                {showNotes ? 'Hide Client Notes' : 'Show Client Notes'}
              </button>
            </FeatureTooltip>

            <FeatureTooltip
              title="Bridal High-Res Zoom"
              summary="Zoom in to inspect jewelry, silk embroidery, and fine skin retouching."
              position="bottom"
              width={260}
            >
              <button
                className={`btn btn-sm btn-ghost`}
                onClick={() => setIsZoomed(!isZoomed)}
              >
                <i className={`bi bi-${isZoomed ? 'zoom-out' : 'zoom-in'}`} />
                {isZoomed ? 'Reset Zoom' : '2× Zoom'}
              </button>
            </FeatureTooltip>

            <FeatureTooltip
              title="Approve Spread Layout"
              summary="Client one-click signoff locking this spread for final physical printing."
              position="bottom"
              width={260}
            >
              <button
                className={`btn btn-sm ${isApproved ? 'btn-primary' : 'btn-ghost'}`}
                onClick={toggleApprove}
              >
                <i className={`bi bi-${isApproved ? 'check-circle-fill' : 'check-circle'}`} />
                {isApproved ? 'Spread Approved' : 'Approve Layout'}
              </button>
            </FeatureTooltip>

            <button className="icon-btn flipbook-close" onClick={onClose} aria-label="Close flipbook">
              <i className="bi bi-x-lg" />
            </button>
          </div>
        </header>

        {/* 3D Realistic Open Album Surface */}
        <div className={`flipbook-stage ${isZoomed ? 'zoomed' : ''}`}>
          <div className="album-spine-shadow" />
          
          <div className="album-book">
            {/* Left Page */}
            <div className="album-page album-page-left">
              <div className="album-photo-wrap">
                <img
                  src={spread.leftImg}
                  alt={spread.leftNote}
                  className="album-photo"
                  loading="lazy"
                />
                <span className="album-caption">{spread.leftNote}</span>
              </div>
              <span className="album-page-num">{currentIdx * 2 + 1}</span>
            </div>

            {/* Book Spine Fold */}
            <div className="album-spine" />

            {/* Right Page */}
            <div className="album-page album-page-right">
              <div className="album-photo-wrap">
                <img
                  src={spread.rightImg}
                  alt={spread.rightNote}
                  className="album-photo"
                  loading="lazy"
                />
                <span className="album-caption">{spread.rightNote}</span>
              </div>
              <span className="album-page-num">{currentIdx * 2 + 2}</span>

              {/* Client Note Sticky Card */}
              {showNotes && spread.comment && (
                <div className="client-sticky-note">
                  <div className="sticky-pin" />
                  <p className="sticky-author">
                    <i className="bi bi-chat-heart-fill" /> Couple's Feedback:
                  </p>
                  <p className="sticky-text">{spread.comment}</p>
                  <span className={`pill pill-${isApproved ? 'success' : 'warning'}`} style={{ marginTop: 6 }}>
                    {isApproved ? 'Changes Applied & Approved' : 'Action Required'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Navigation & Controls */}
        <footer className="flipbook-footer">
          <FeatureTooltip
            title="Previous Page Spread"
            summary="Press Left Arrow or click to turn back a spread."
            position="top"
            width={220}
          >
            <button
              className="btn btn-ghost"
              onClick={prev}
              disabled={currentIdx === 0}
            >
              <i className="bi bi-arrow-left" /> Previous Spread
            </button>
          </FeatureTooltip>

          {/* Spread Dots / Thumbnail Bar */}
          <div className="flipbook-thumbnails">
            {sampleSpreads.map((s, idx) => (
              <FeatureTooltip
                key={s.spreadNum}
                title={`Spread ${s.spreadNum}: ${s.title}`}
                summary={s.comment ? 'Contains couple feedback' : 'Ready for review'}
                badge={approvedSpreads[idx] || s.status === 'Approved' ? 'Approved' : 'Review'}
                position="top"
                width={230}
              >
                <button
                  className={`spread-dot ${idx === currentIdx ? 'active' : ''} ${
                    approvedSpreads[idx] || s.status === 'Approved' ? 'approved' : ''
                  }`}
                  onClick={() => setCurrentIdx(idx)}
                >
                  <span>{idx + 1}</span>
                </button>
              </FeatureTooltip>
            ))}
          </div>

          <FeatureTooltip
            title="Next Page Spread"
            summary="Press Right Arrow or click to turn forward."
            position="top"
            width={220}
          >
            <button
              className="btn btn-primary"
              onClick={next}
              disabled={currentIdx === sampleSpreads.length - 1}
            >
              Next Spread <i className="bi bi-arrow-right" />
            </button>
          </FeatureTooltip>
        </footer>
      </div>
    </div>
  )
}

export default FlipbookModal
