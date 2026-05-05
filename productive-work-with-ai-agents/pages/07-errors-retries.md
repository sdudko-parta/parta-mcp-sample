# Errors and Retries

Agents fail. The good ones notice, recover, and keep going; the bad ones spiral. Most of that is your design, not the model.

![Errors and retries](../assets/07-errors-retries.png)

## Three failure modes

1. **Tool error.** Argument was wrong, network blipped, file didn't exist. Show the error verbatim and let the agent retry with a different argument.
2. **Wrong path.** The agent tried something that worked but doesn't solve the goal. The cure is feedback — automated checks, or a human reviewer mid-loop.
3. **Confused state.** The context contradicts itself; the agent picks one branch and runs. Truncate, summarize, restart with a smaller working set.

## Don't auto-retry forever

Retry budgets exist for a reason. Five attempts on the same failing tool is a signal that the **plan is wrong**, not that the tool is flaky. Fail loudly, surface to the user, and let them course-correct.

## A practical rule

If the agent is stuck on something a junior engineer would also be stuck on, the answer isn't more tokens — it's better tools or a better brief.
