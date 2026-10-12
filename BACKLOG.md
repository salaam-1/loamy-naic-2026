# Loamy Platform — Post-stage backlog

Improvements and adjustments noted during the staged build, to be implemented
AFTER all stages are done. Nothing here is forgotten-by-design; each item gets
scheduled once Stage 6 verifies.

## 1. Face verification at signup / sign-in (requested 2026-07-13)

After migration to official launch, everyone signing up (and existing users on
first sign-in after launch) completes a face verification:

- The captured face image automatically becomes their profile picture and
  CANNOT be changed from the dashboard.
- Identity fields (full name, and other identity data) also become immutable
  from the user's own dashboard once verified.
- Requires an admin/support path for legitimate corrections (typos, legal name
  changes) — identity lockdown without a correction path creates support debt.

**SECURITY-REVIEW (mandatory before build):** face images are biometric
identity data — NDPR/NDPA implications, encrypted storage in a PRIVATE bucket,
retention policy, consent copy at capture, and liveness-check vendor selection
all need the backend engineer's sign-off first. Same review gate as BVN/NIN.

Implementation sketch (to validate later): capture via getUserMedia at
signup/onboarding → private storage bucket → verification state on profile →
Settings page hides avatar/name editing when `identity_locked` → the Stage 4
field-verification flow can double-check the face image in person.
