# Hook Proof Analysis (2026-06-19)

## Data Summary
- Total records: 961
- Normal tool calls: 669
- Loop detections: 279 (41.7% detection rate)

## Loop Type Breakdown
- action_loop: 158 (56.6%)
- output_loop: 119 (42.7%)
- error_loop: 2 (0.7%)

## Key Finding: action_loop repeats=2 is almost entirely false positives
- repeats=2: 100 detections ← likely false positives (normal work pattern)
- repeats=3: 32 detections ← likely false positives
- repeats=4: 14 detections ← borderline
- repeats≥5: 27 detections ← likely real loops

## Recommendation
- action_loop threshold should be raised from 2 to at least 4
- Or: only block on repeats≥5, warn on 2-4
- output_loop threshold of 6 seems more reasonable (repeats=6: 43 detections)
- error_loop is rare (2 detections) and likely genuine

## Tools Most Flagged
- exec: 129 — most used tool, highest false positive rate
- read: 39
- edit: 36
- browser: 18
- write: 17
