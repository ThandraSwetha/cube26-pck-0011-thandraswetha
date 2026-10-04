# Pack Manager — CUBE Buildathon 2026

## 1. Problem Statement

Pack Manager is the outbound packing verification step for merchant-fulfilled and 3PL orders.

Before a package is sealed, the system receives a photo of the open box and verifies:

- Every expected item is present.
- The quantity of each item is correct.
- No unexpected extra item is present.
- Uncertain observations are not treated as a successful verification.

The system produces one of the following decisions:

- `SEAL` — all required checks passed.
- `STOP_AND_FIX` — an item is missing, quantity is incorrect, or an extra item is detected.
- `REVIEW` — the system cannot confidently verify the package and human review is required.

---

## 2. Our Solution

We built a full-stack Pack Manager application that combines:

1. Order data
2. Vision-provider abstraction
3. Deterministic decision engine
4. Evidence generation
5. Inspection history
6. Image capture and hashing
7. Uncertainty handling
8. Tenant isolation
9. React-based operator interface

The solution uses a replaceable vision-provider architecture with real multimodal image analysis through Google Gemini and OpenAI, while keeping the final packing decision in a deterministic verification engine.

A deterministic mock provider is also included for automated tests and demonstrations.

### High-Level Flow

```text
Order / Expected Items
        |
        v
Open-Box Image
        |
        v
Vision Provider
        |
        v
Detected Items + Uncertainty
        |
        v
Decision Engine
        |
        +----------------------+
        |          |           |
        v          v           v
      SEAL    STOP_AND_FIX   REVIEW
        |
        v
Evidence + Inspection Record
        |
        v
Operator UI
```

## 3. Vision and Decision Boundaries

The system accepts an open-box package image and uses a replaceable vision-provider architecture. Google Gemini is the current real provider for image analysis; OpenAI is also supported through the same provider abstraction. A deterministic mock provider is retained for tests and demonstrations.

The vision provider identifies observed items, quantities, confidence, image quality, and uncertainty. It does not make the final packing decision. The deterministic decision engine compares expected order items with detected items and evaluates presence, quantity, and extra-item checks independently.

Any `FAIL` results in `STOP_AND_FIX`. If there is no `FAIL` but uncertainty remains, the result is `REVIEW`. Only when all required checks `PASS` is the result `SEAL`. Vision errors and timeouts do not become successful verifications; the inspection is preserved for review.

## 4. Key Features

- Real multimodal image analysis through Gemini, with OpenAI support
- Replaceable vision-provider architecture and mock provider for testing
- Deterministic verification engine with independent presence, quantity, and extra-item checks
- Uncertainty-aware decisions using `UNCERTAINTY`
- Evidence capture, SHA-256 image hashing, and inspection history
- Tenant/org isolation
- React operator interface
- Automated tests
- Image upload validation for supported image types and an 8 MB limit
- Fail-open handling for vision errors and timeouts

## 5. Testing

- Automated test suite: 26 tests passing.
- Production build: verified successfully.
- Gemini multimodal request construction and structured-response parsing are tested with mocked API responses; no live Gemini inference evaluation is claimed.
- Missing-item, wrong-quantity, extra-item, timeout, and tenant-isolation behavior are covered by tests.
- The mock vision provider and its scenarios are tested separately.

## 6. Run Locally

From the project root:

```bash
cd submissions/thandraswetha/agent
npm ci
npm run dev
```

The development command starts the frontend and backend together. Configure environment variables in a local `.env` file using `.env.example` as a template. Do not commit real API keys.

## 7. Architecture

```text
Order Data
   ↓
Open-Box Image
   ↓
Vision Provider
(Gemini / OpenAI / Mock)
   ↓
Detected Items + Confidence + Uncertainty
   ↓
Deterministic Decision Engine
   ↓
Presence + Quantity + Extra Item Checks
   ↓
SEAL / STOP_AND_FIX / REVIEW
   ↓
Evidence + Inspection History
   ↓
React Operator UI
```

This architecture separates image understanding from the final deterministic business decision.

## 8. Technology Stack

- React
- Vite
- JavaScript
- Node.js
- Express.js
- PGlite
- Google Gemini Vision
- OpenAI Vision support
- REST APIs
- SHA-256 hashing
- Automated tests
