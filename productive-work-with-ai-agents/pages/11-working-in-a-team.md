# Working in a Team

A solo workflow with an agent is one set of habits. A team workflow is a different one. The agent doesn't change — your teammates do.

## Make the rules legible

Most teams already have norms: how to name branches, when to add tests, what "done" means. If those norms only live in someone's head, every teammate's agent will violate them differently.

Write them down where the agent will read them — usually a `CLAUDE.md`, `AGENTS.md`, or a project README. Two principles:

- **Short and load-bearing.** Skip the obvious. Capture the things people get wrong.
- **One source of truth.** When the rules change, change them in the file. Don't paste updates into individual chats.

## Hand off the same way you would to a person

If a teammate asks for a code review, they don't dump a 4000-line diff and walk away. The same is true when an agent opens a PR on your behalf.

- Title and description: state the goal and the constraint, not just the change.
- Link to the brief, the issue, or the conversation. Reviewers shouldn't have to guess motivation.
- Flag the parts you didn't review carefully so the next reviewer knows where to focus.

## Reviewing someone else's agent work

Agent-authored code looks plausible by default. That's the trap. When reviewing:

- Read the diff like you wrote it. Don't outsource judgment to the LLM that produced it.
- Check the parts the author skimmed — error paths, edge cases, anything labeled "small change."
- If you don't understand why a line exists, ask. "Why this?" is a better question than "looks fine."

## Shared context, not shared sessions

Don't try to share an agent session across teammates — context drifts, memory diverges, and nobody knows what the agent has been told.

Share the **inputs** instead: the rules file, the prompts, the examples of good output. Each teammate's agent should be able to start cold and produce work that looks like it came from the same team.

## A short rule

Treat agent output as your output. Your name's on the PR; the review standard is the same.
