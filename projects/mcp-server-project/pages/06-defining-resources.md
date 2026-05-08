# Defining Resources

Resources are the **nouns** of your server — read-only blobs the agent can pull when it needs context. Think files, database rows, API responses.

![Resources](../assets/06-defining-resources.png)

## When to choose a resource over a tool

Use a resource when:

- the data is read-only,
- the agent (or user) might want to attach it to a prompt without you running code,
- a stable URI makes sense (`file:///notes/2026-Q2.md`, `db://users/42`).

Use a tool when there's a **decision** or **side effect** involved (filter, search, write).

## Sketch in code

```ts
server.resource(
  "current-user-profile",
  "user://me",
  { description: "The signed-in user's profile JSON." },
  async () => ({
    contents: [{
      uri: "user://me",
      mimeType: "application/json",
      text: JSON.stringify(await loadCurrentUser()),
    }],
  })
);
```

## Templates for many

If your URIs follow a pattern (`note:///<id>`), register a **resource template** instead of one resource per id, and let the SDK route requests for you.
