# Errors and Retries

Agents fail. The good ones notice, recover, and keep going; the bad ones spiral. Most of that is your design, not the model.

![Errors and retries](../assets/07-errors-retries.png)

## Three failure modes

1. **Tool error.** Argument was wrong, network blipped, file didn't exist. Show the error verbatim and let the agent retry with a different argument.
2. **Wrong path.** The agent tried something that worked but doesn't solve the goal. The cure is feedback — automated checks, or a human reviewer mid-loop.
3. **Confused state.** The context contradicts itself; the agent picks one branch and runs. Truncate, summarize, restart with a smaller working set.

## Don't auto-retry forever

Retry budgets exist for a reason. Five attempts on the same failing tool is a signal that the **plan is wrong**, not that the tool is flaky. Fail loudly, surface to the user, and let them course-correct.

## Backoff and idempotency

Two cheap habits that change retry from "make it worse" to "make it work":

1. **Exponential backoff with jitter.** A tool that just failed will probably fail again on the very next call. Wait a little — and randomize the wait so a hundred parallel agents don't retry in lockstep. A common shape is `min(cap, base * 2^attempt) + random(0, base)`. Cap at something the user can wait for; budget the **total** wait, not just the per-attempt one.
2. **Idempotency before retry.** Retrying a read is free. Retrying a write can double-charge a card or create two pull requests. Make the tool idempotent before you make it retryable: an idempotency key on the request, or a check-then-act inside the tool that no-ops if the work is already done. Tools without that property should fail closed — surface the error and let the user decide.

A useful split: distinguish **transient** failures (network, rate limit, 5xx) — retry — from **deterministic** ones (4xx, schema mismatch, missing resource) — don't. The agent burning its budget on a 404 is the most common version of the spiral.

## A practical rule

If the agent is stuck on something a junior engineer would also be stuck on, the answer isn't more tokens — it's better tools or a better brief.
