# What is an AI Agent?

An AI agent is a model that can **decide** what to do next, **act** on the world through tools, and **loop** on the result.

![What is an agent](../assets/02-what-is-an-agent.png)

## Agent vs. chatbot

A chatbot replies. An agent plans, calls a tool, looks at the response, and decides whether to keep going. The difference isn't model capability — it's the loop wrapped around the model.

## The minimum loop

```
while not done:
    plan   = model.decide(context)
    result = tools.run(plan.action)
    context.append(plan, result)
```

That's it. Everything fancier (sub-agents, planning trees, reflection) is a variation on that loop.

## Why this matters for you

If you treat an agent like a chatbot, you'll over-explain the task and it'll still get stuck. If you treat it like a junior teammate with tools, you'll brief it, give it room, and review its work. The second mode is where the productivity wins live.
