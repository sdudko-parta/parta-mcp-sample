# Errors and Retries

Agents fail. The good ones notice, recover, and keep going; the bad ones spiral. Most of that is your design, not the model.

![Errors and retries](../assets/07-errors-retries.png)

## Four failure modes

1. **Tool error.** Argument was wrong, network blipped, file didn't exist. Show the error verbatim and let the agent retry with a different argument — but only when the tool is safe to retry (see below).
2. **Wrong path.** The agent tried something that worked but doesn't solve the goal. The cure is feedback — automated checks, or a human reviewer mid-loop.
3. **Confused state.** The context contradicts itself; the agent picks one branch and runs. Truncate, summarize, restart with a smaller working set.
4. **Stale assumption.** A fact that *was* true at the start of the session no longer is — a file got moved, a flag flipped, the schema changed. Re-read before re-acting; never let the agent trust its own memory of a value when a cheap re-fetch is available.

## Don't auto-retry forever

Retry budgets exist for a reason. Five attempts on the same failing tool is a signal that the **plan is wrong**, not that the tool is flaky. Fail loudly, surface to the user, and let them course-correct.

## Backoff and idempotency

Two cheap habits that change retry from "make it worse" to "make it work":

1. **Exponential backoff with jitter.** A tool that just failed will probably fail again on the very next call. Wait a little — and randomize the wait so a hundred parallel agents don't retry in lockstep. A common shape is `min(cap, base * 2^attempt) + random(0, base)`. Cap at something the user can wait for; budget the **total** wait, not just the per-attempt one.
2. **Idempotency before retry.** Retrying a read is free. Retrying a write can double-charge a card or create two pull requests. Make the tool idempotent before you make it retryable: an idempotency key on the request, or a check-then-act inside the tool that no-ops if the work is already done. Tools without that property should fail closed — surface the error and let the user decide.

A useful split: distinguish **transient** failures (network, rate limit, 5xx) — retry — from **deterministic** ones (4xx, schema mismatch, missing resource) — don't. The agent burning its budget on a 404 is the most common version of the spiral.

## Make failure visible

Silent failure is the worst kind. An agent that quietly retries five times and quietly gives up leaves you with a passing-looking session and a broken outcome. Two things to put in front of every retry loop:

![Observability surfaces every retry, every backoff, every give-up](../assets/07-errors-retries-observability.png)

- **Structured logs at the boundary.** One line per attempt: the tool call, the error class, the attempt number, the next backoff. When something looks weird two days later, you can grep your way to the cause without re-running the agent.
- **An alert when the budget burns.** If the agent gave up on a goal because retries were exhausted, that should page a human, not just appear in a transcript nobody reads. Treat "agent gave up" as a real signal — not noise — until you have data that says otherwise.

## A practical rule

If the agent is stuck on something a junior engineer would also be stuck on, the answer isn't more tokens — it's better tools or a better brief.
