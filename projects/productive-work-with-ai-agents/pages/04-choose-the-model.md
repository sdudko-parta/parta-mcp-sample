# Choose the Right Model

Models aren't interchangeable. Pick one for the job in front of you.

![Choose the model](../assets/04-choose-the-model.png)

## Three axes

1. **Capability.** Multi-step reasoning, code synthesis, recovery from errors. Bigger model, fewer surprises.
2. **Speed.** Latency per turn matters when you're in a tight edit loop. A 2× faster model that's 90% as smart can win on throughput.
3. **Context window.** If your task spans a million tokens of code, a small context model will thrash regardless of capability.

## Heuristic

- **Quick refactors, scripted changes, narrow scope:** small/fast model.
- **Architecture work, debugging across files, novel features:** big model.
- **Long-running agentic loops:** big model with a big context window; cost is amortized over many turns.

## Don't overthink it

If the task is hard, default to the most capable model and only step down once you're sure the smaller one is good enough. Your time is more expensive than tokens.
