# Designing Agent Prompts

A long-running agent is more sensitive to its system prompt than a one-shot chat is. Get it right and the next thousand turns benefit.

![Prompt design](../assets/06-prompt-design.png)

## A useful skeleton

1. **Role.** One sentence. "You are a senior backend engineer pairing with the user."
2. **Operating principles.** Short bullets. Things you want the agent to do **always**, not per-task.
3. **Tools.** A pointer that tools exist; describe them on the tool itself, not in the prompt.
4. **Failure handling.** What to do when blocked, when uncertain, when the user contradicts itself.
5. **Output format.** Only when consistency matters more than fluency.

## What to leave out

- Long preambles ("You are a brilliant 10x engineer..."). The model won't get smarter and your context window shrinks.
- Negative examples of what not to do. Most models follow positive instructions better.
- Restating instructions that are already in tool docstrings.

## When to iterate

If the agent is failing the same way three times in a row, change the prompt or change the tool — don't repeat the brief louder.
