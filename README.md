# Cube Buildathon · 03 · Pack Manager

**Commerce Context stream · Round 2 · Individual Build**

## Pack Manager — Vision-Assisted Outbound Order Verification

Pack Manager is a vision-assisted agent for merchant-fulfilled and 3PL outbound orders.

Before an order is sealed, the operator provides a photograph of the open box. The agent compares the expected order contents with the detected contents and produces a decision:

- **SEAL** — expected items and quantities are satisfied and no extra items are detected.
- **STOP_AND_FIX** — a confident mismatch is detected, such as a missing item, wrong quantity, or extra item.
- **REVIEW** — the evidence is insufficient or the vision provider fails, so the system does not allow an unsafe automatic seal.

The system also stores evidence so that another downstream process can understand what was expected, what was detected, which checks were performed, and why the final decision was produced.

---

## 1. Problem Understanding

Pack Manager represents **Step 3 of 5** in the Commerce Context chain.

```text
Supplier delivery
       ↓
01 Receiving
       ↓
02 Prep
       ↓
03 Pack Manager  ← This project
       ↓
04 Returns
       ↓
05 Recovery
