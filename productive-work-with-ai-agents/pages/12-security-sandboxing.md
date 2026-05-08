# Security and Sandboxing

An agent runs your code, reads your files, and calls your APIs. The cost of getting it wrong scales with the trust you give it. Most accidents aren't malice — they're an agent following its brief into a place it shouldn't have been able to reach.

![Security and sandboxing](../assets/12-security-sandboxing.png)

## What "sandboxing" actually means here

Three layers, from coarse to fine:

1. **Process isolation.** The agent runs in a container, VM, or worktree — not on the host shell. A bad command can't `rm -rf` your home directory because it doesn't have one to reach.
2. **Filesystem scope.** The agent can only read and write inside a specific directory. Secrets, SSH keys, and other repos are not on its map.
3. **Network scope.** Outbound calls are restricted to a known allowlist (your APIs, package registries) — not arbitrary URLs the agent decided to fetch.

Most agent runtimes give you at least the first two. The third one is the most often skipped and the most dangerous when missed.

## Tools are the actual attack surface

The model itself is sandboxed by virtue of being a text generator — it can't `execute` anything. The tools you give it are the real privileges. Audit them like you would any service account:

- **Least privilege on the underlying credential.** A "read GitHub" tool should hold a token scoped to read, not the personal access token that can also delete branches.
- **Scope by parameter, not by trust.** If the tool can write any file, it can write `~/.ssh/authorized_keys` — even if your prompt says not to. Constrain the path **inside the tool**, not in the prompt.
- **No shell-out tools without an allowlist.** A generic `run_command(cmd)` tool is effectively root inside the sandbox. Replace it with named tools (`run_tests`, `lint`, `build`) that take only the args they need.

## Secrets

The two failure modes:

1. **Secrets in context.** API keys, DB passwords, and tokens pasted into a prompt or printed by a tool become part of the model's working set. They can be regurgitated into a log, a commit, or another tool call.
2. **Secrets in tool output.** A tool that prints `Bearer abc123` in an error message has just shown the model a credential. The model has no concept of "redact this."

Practical rules:

- Pass secrets to tools out-of-band (env vars, secret managers) — never through arguments the model writes.
- Strip credentials from tool output before returning it. Log the redacted version too.
- Treat the agent's transcript as quotable. If a value being in the transcript would be a problem, don't put it there.

## Prompt injection is a real category

If the agent reads anything that wasn't written by you — a webpage, an email, a PR description, a file someone else edited — that text can contain instructions, and the model will sometimes follow them. The mitigation is structural, not stylistic:

- **Untrusted content goes into a clearly-bounded slot.** Tag it. Tell the model explicitly that text inside that slot is data, not commands.
- **Tools that can act outside the sandbox require confirmation.** Sending email, opening a PR, transferring money — gate behind a user click, not just an agent decision.
- **Don't chain unconfirmed reads into confirmed writes.** A summary tool reading a hostile webpage shouldn't be able to call a "send email" tool with the summary's "instructions."

## A short rule

Assume every tool will eventually be called with the worst plausible arguments. If that scenario is survivable, the tool is safe to ship. If it isn't, narrow the tool — don't tighten the prompt.
