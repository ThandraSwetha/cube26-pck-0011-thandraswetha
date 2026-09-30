                ┌─────────────────┐
                │   React UI      │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ Express API     │
                └────────┬────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
       Vision Provider        Order Data
              │
              ▼
      Normalized Detections
              │
              ▼
       Decision Engine
              │
       ┌──────┼─────────┐
       ▼      ▼         ▼
     SEAL   STOP/FIX   REVIEW