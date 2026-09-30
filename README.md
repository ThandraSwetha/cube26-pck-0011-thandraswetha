# Cube Buildathon · 03 · Pack Manager

**Commerce Context · Round 2 · Individual Build**

# Pack Manager — Vision-Assisted Outbound Order Verification

## 1. Problem Statement

In an outbound packing process, a picker places products into a box before the package is sealed.

A wrong item, missing item, incorrect quantity, or extra item can result in:

- Wrong shipments
- Customer complaints
- Returns
- Refunds
- Replacement shipments
- Additional operational cost

Manual verification of every package is time-consuming and expensive.

### The problem

Before sealing an outbound order, we need to answer:

> **Does the open box contain exactly what the customer ordered?**

The Pack Manager must verify:

1. Are all expected items present?
2. Is the quantity correct for every item?
3. Is there any unexpected/extra item?
4. Is the evidence reliable enough to make a decision?
5. Should the box be sealed or stopped for correction?

---

# 2. Our Solution

We built **Pack Manager**, a vision-assisted verification application that checks the contents of an open box before it is sealed.

The operator selects an order and uploads a photograph of the open box.

The system then follows this workflow:

```text
Customer Order
      ↓
Expected Order Lines
      ↓
Open-Box Image
      ↓
Vision Provider
      ↓
Detected Items
      ↓
Presence Check
      ↓
Quantity Check
      ↓
Extra Item Check
      ↓
Evidence Generation
      ↓
Final Decision
