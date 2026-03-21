---
trigger: always_on
---

# Always Review High Risk Changes

For any change involving:
- interview state logic
- LLM output parsing
- report generation
- auth/session logic
- candidate-facing timeout logic
- API integration
the agent must run the Production Code Review workflow before considering the task complete.