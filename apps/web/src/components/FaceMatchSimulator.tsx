import { useState } from 'react'
import guest1 from '../assets/face-demo/guest-1.jpg'
import guest2 from '../assets/face-demo/guest-2.jpg'
import guest3 from '../assets/face-demo/guest-3.jpg'
import photo1 from '../assets/face-demo/photo-1.jpg'
import photo2 from '../assets/face-demo/photo-2.jpg'
import photo3 from '../assets/face-demo/photo-3.jpg'
import photo4 from '../assets/face-demo/photo-4.jpg'
import photo5 from '../assets/face-demo/photo-5.jpg'
import photo6 from '../assets/face-demo/photo-6.jpg'
import photo7 from '../assets/face-demo/photo-7.jpg'
import photo8 from '../assets/face-demo/photo-8.jpg'
import photo9 from '../assets/face-demo/photo-9.jpg'
import { FeatureTooltip } from './ui'

const sampleGuests = [
  {
    id: 'guest-1',
    name: 'Ananya Iyer',
    role: "Bride's Sister",
    avatar: guest1,
    matchedPhotos: [
      {
        id: 'img-101',
        url: photo1,
        event: 'Sangeet Dance',
        confidence: 99.8,
        tag: 'Lead Performer'
      },
      {
        id: 'img-102',
        url: photo2,
        event: 'Haldi Laughs',
        confidence: 99.4,
        tag: 'Candid Group'
      },
      {
        id: 'img-103',
        url: photo3,
        event: 'Mandap Blessings',
        confidence: 98.9,
        tag: 'Portrait'
      },
      {
        id: 'img-104',
        url: photo4,
        event: 'Baraat Welcome',
        confidence: 99.1,
        tag: 'Family Candid'
      }
    ]
  },
  {
    id: 'guest-2',
    name: 'Vikram Nair',
    role: "Groom's Brother",
    avatar: guest2,
    matchedPhotos: [
      {
        id: 'img-201',
        url: photo5,
        event: 'Baraat Entrance',
        confidence: 99.7,
        tag: 'Action Shot'
      },
      {
        id: 'img-202',
        url: photo6,
        event: 'Cocktail Toast',
        confidence: 98.8,
        tag: 'Portrait'
      },
      {
        id: 'img-203',
        url: photo7,
        event: 'Reception Dinner',
        confidence: 99.2,
        tag: 'Candid Group'
      }
    ]
  },
  {
    id: 'guest-3',
    name: 'Meera & Aunties',
    role: 'Immediate Family',
    avatar: guest3,
    matchedPhotos: [
      {
        id: 'img-301',
        url: photo8,
        event: 'Muhurtham Blessings',
        confidence: 99.5,
        tag: 'Traditional Ritual'
      },
      {
        id: 'img-302',
        url: photo9,
        event: 'Bridal Trousseau',
        confidence: 98.7,
        tag: 'Close-Up'
      }
    ]
  }
]

export function FaceMatchSimulator({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [selectedGuest, setSelectedGuest] = useState(sampleGuests[0])
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState(100)

  if (!isOpen) return null

  const handleSelectGuest = (guest: (typeof sampleGuests)[number]) => {
    setSelectedGuest(guest)
    setScanning(true)
    setScanProgress(0)

    const interval = setInterval(() => {
      setScanProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval)
          setScanning(false)
          return 100
        }
        return prev + 25
      })
    }, 120)
  }

  return (
    <div className="flipbook-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="face-sim-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <header className="face-sim-header">
          <div>
            <div className="eyebrow-row">
              <span className="pill pill-success"><i className="bi bi-cpu-fill" /> AI Neural Demo</span>
              <span className="pill pill-warning">Zero App Needed</span>
            </div>
            <h2>Live AI Face Recognition Simulator</h2>
            <p className="muted">
              Select a guest selfie below to simulate how wedding attendees discover their photos in under 1.5 seconds.
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close demo">
            <i className="bi bi-x-lg" />
          </button>
        </header>

        {/* Guest Selector Bar */}
        <div className="guest-selector-bar">
          <p className="guest-selector-label">
            <i className="bi bi-person-bounding-box" /> Select a guest selfie to test:
          </p>
          <div className="guest-cards">
            {sampleGuests.map((g) => (
              <FeatureTooltip
                key={g.id}
                title={g.name}
                summary={`Simulate selfie scan for ${g.role}.`}
                position="top"
                width={200}
              >
                <button
                  className={`guest-card ${selectedGuest.id === g.id ? 'active' : ''}`}
                  onClick={() => handleSelectGuest(g)}
                >
                  <img src={g.avatar} alt={g.name} className="guest-avatar" />
                  <div>
                    <strong>{g.name}</strong>
                    <span>{g.role}</span>
                  </div>
                  {selectedGuest.id === g.id && (
                    <span className="guest-active-check">
                      <i className="bi bi-check-circle-fill" />
                    </span>
                  )}
                </button>
              </FeatureTooltip>
            ))}
          </div>
        </div>

        {/* Live Scanner Display */}
        <div className="sim-scan-area">
          <div className="sim-selfie-box">
            <div className="selfie-frame">
              <img src={selectedGuest.avatar} alt={selectedGuest.name} className="selfie-img" />
              {scanning && <div className="scanning-laser-line" />}
              <div className="face-mesh-overlay">
                <span className="face-corner tl" />
                <span className="face-corner tr" />
                <span className="face-corner bl" />
                <span className="face-corner br" />
              </div>
            </div>

            <div className="selfie-status">
              <strong>{scanning ? 'Neural Scanning...' : 'Match Confirmed'}</strong>
              <p className="muted">
                {scanning
                  ? `Extracting 512D facial landmarks (${scanProgress}%)...`
                  : `1.2s search across 2,140 photos`}
              </p>
              <div className="progress" style={{ height: 6, marginTop: 8 }}>
                <span style={{ width: `${scanProgress}%` }} />
              </div>
            </div>
          </div>

          {/* Results Gallery */}
          <div className="sim-results-box">
            <div className="sim-results-header">
              <div>
                <h3>
                  {scanning ? 'Matching photos...' : `${selectedGuest.matchedPhotos.length} Photos Found for ${selectedGuest.name}`}
                </h3>
                <span className="muted" style={{ fontSize: 12 }}>
                  Studio watermark automatically attached · Ready for WhatsApp & Instagram
                </span>
              </div>

              {!scanning && (
                <FeatureTooltip
                  title="Download All with Watermark"
                  summary="Simulates guest downloading their complete matched collection."
                  position="left"
                  width={250}
                >
                  <button className="btn btn-sm btn-gold">
                    <i className="bi bi-download" /> Download All ({selectedGuest.matchedPhotos.length})
                  </button>
                </FeatureTooltip>
              )}
            </div>

            {scanning ? (
              <div className="sim-scanning-state">
                <i className="bi bi-cpu rotating-icon" />
                <p>Matching facial vectors against wedding gallery...</p>
              </div>
            ) : (
              <div className="matched-grid">
                {selectedGuest.matchedPhotos.map((photo) => (
                  <FeatureTooltip
                    key={photo.id}
                    title={`${photo.event} · ${photo.confidence}% match`}
                    summary={`Detected as '${photo.tag}'. Original high-res raw file index synced.`}
                    position="top"
                    width={240}
                  >
                    <div className="matched-card">
                      <img src={photo.url} alt={photo.event} className="matched-img" />
                      <div className="matched-overlay">
                        <span className="matched-conf-pill">{photo.confidence}% Match</span>
                        <span className="watermark-preview">© Golden Hour</span>
                      </div>
                      <div className="matched-info">
                        <strong>{photo.event}</strong>
                        <span>{photo.tag}</span>
                      </div>
                    </div>
                  </FeatureTooltip>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default FaceMatchSimulator
