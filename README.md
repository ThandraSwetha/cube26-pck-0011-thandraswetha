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
