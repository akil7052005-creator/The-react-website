// Sample content for the AI Face Recognition screen. The feature is out of
// scope for v1 and hidden behind FEATURE_FACE_RECOGNITION; this keeps the
// screen working as a demo if the flag is turned on, until it gets a backend.
export const faceDemo = {
  stats: { faceMatches: { value: 12480, trend: 21 } },
  scans: { label: 'Face scans', used: 4200, limit: 10000, unit: '' },
  faceEvents: [
    { event: 'Meera & Vikram Engagement', photos: 2140, guests: 186, matched: 171, status: 'Live' },
    { event: 'Kavya & Aditya Wedding', photos: 4820, guests: 412, matched: 398, status: 'Live' },
    { event: 'Divya & Arvind Wedding', photos: 3310, guests: 290, matched: 104, status: 'Processing' },
    { event: 'Priya & Karthik Wedding', photos: 0, guests: 0, matched: 0, status: 'Not Started' },
  ],
}
