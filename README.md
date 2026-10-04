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

# 2. Our Solution

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

The vision provider is replaceable without changing the core decision logic. The project includes a deterministic mock provider for tests and demonstrations, plus real multimodal providers for Google Gemini and OpenAI.

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

## 3. Vision and Decision Boundaries

The selected vision provider analyzes the uploaded image and returns structured visual observations: detected items, quantities, image quality, uncertainty, and evidence. It does not decide whether the package passes inspection.

The deterministic decision engine compares those observations against the expected order and determines check outcomes and the final action:

- `PASS`, `FAIL`, or `UNCERTAIN` for verification checks.
- `SEAL`, `STOP_AND_FIX`, or `REVIEW` for the final decision.

If provider analysis fails, times out, is rate-limited, or returns invalid output, the inspection is saved as `PENDING` and requires `REVIEW`. The uploaded image and its SHA-256 evidence are preserved for traceability. Tenant-scoped storage continues to isolate orders, inspections, and captures.

## 4. Run Locally

From `submissions/thandraswetha/agent`:

```sh
npm ci
```

Copy `.env.example` to `.env` and set the provider key locally. Never commit `.env` or place API keys in source files.

Gemini configuration:

```dotenv
VISION_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_VISION_MODEL=gemini-3.5-flash-lite
VISION_TIMEOUT_MS=30000
```

OpenAI is also available with `VISION_PROVIDER=real`, `OPENAI_API_KEY`, and optional `OPENAI_VISION_MODEL` / `OPENAI_BASE_URL`. Use `VISION_PROVIDER=mock` for deterministic demonstration and automated tests; mock scenarios do not infer from pixels.

Start the API and frontend together:

```sh
npm run dev
```

Run checks and build the frontend:

```sh
npm test
npm run build
```

Vite writes the production frontend to `web/dist`, which is the directory served by the backend.
