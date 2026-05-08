# Designing Agent Prompts

A long-running agent is more sensitive to its system prompt than a one-shot chat is. Every turn re-reads it. Get it right and the next thousand turns benefit.

![Prompt design](../assets/06-prompt-design.png)

## A useful skeleton

1. **Role.** One sentence. "You are a senior backend engineer pairing with the user."
2. **Operating principles.** Short bullets. Things you want the agent to do **always**, not per-task.
3. **Tools.** A pointer that tools exist; describe them on the tool itself, not in the prompt.
4. **Failure handling.** What to do when blocked, when uncertain, when the user contradicts itself.
5. **Output format.** Only when consistency matters more than fluency.

## Two short examples

A solid system prompt for a coding agent:

```text
You are a senior engineer pairing with the user inside their repository.

- Read before you write. Open the file you're about to change.
- Match the surrounding code's style; don't introduce new patterns mid-file.
- When blocked or unsure, ask one focused question instead of guessing.
- Make small, reviewable diffs. One concern per change.
```

A weaker version of the same idea — verbose, vague, and easy for the model to drift from:

```text
You are an extremely brilliant 10x senior staff engineer with deep
expertise across all languages and frameworks. Always write the
highest-quality code possible. Never make mistakes. Be thorough.
Think carefully about edge cases. Don't be lazy.
```

The first one tells the agent what to **do**. The second one tells it how to **feel**.

## What to leave out

- Long preambles. The model won't get smarter and your context window shrinks.
- Negative examples of what not to do. Most models follow positive instructions better.
- Restating instructions that are already in tool docstrings.

## When to iterate

If the agent is failing the same way three times in a row, change the prompt or change the tool — don't repeat the brief louder.
