# Goals and Constraints

The single biggest lever you have is the brief. State the goal, then state the constraints.

![Goals and constraints](../assets/03-goals-constraints.png)

## A brief that works

> Refactor `payments/refund.ts` to extract the eligibility checks into a pure function. Don't change behavior. Don't touch the tests except to import the new function. Keep the public API of the module intact.

That brief tells the agent **what success is** (extracted pure function), **what to leave alone** (behavior, tests, public API), and **the scope** (one file).

## What to put in the constraints

- Files or modules the agent should not touch.
- Patterns the team avoids ("no inheritance", "no dynamic SQL").
- Performance or compatibility floors.
- Output shape ("single PR", "rebase, don't merge").

## What to leave out

Don't over-specify the **how**. If you knew exactly how to do it, you'd type it. The agent earns its keep by working out the steps; your job is to bound the search space.
