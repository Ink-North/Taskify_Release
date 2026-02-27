# Taskify Agent Mode

Taskify Agent Mode is enabled by opening the app with `?agent=1`. Browser agents should send one strict JSON command object at a time through the Agent Mode panel or through `window.taskifyAgent.exec(...)`.

`Allow Agent Commands` is enabled by default for new installs. If a user turns it off in Settings, only `meta.help` succeeds. Agent security can also be enabled with trusted `npub`s and modes `off`, `moderate`, or `strict`.

The dispatcher accepts any positive integer protocol version in `v`, and also accepts `version` as an alias. Compatible commands are still routed through the same operation set.

## Command Envelope

```json
{
  "v": 1,
  "id": "agent-chosen-id",
  "op": "meta.help",
  "params": {}
}
```

## Response Envelope

```json
{
  "v": 1,
  "id": "agent-chosen-id",
  "ok": true,
  "result": {},
  "error": null
}
```

## Copy/Paste Examples

### `meta.help`

```json
{
  "v": 1,
  "id": "help-1",
  "op": "meta.help",
  "params": {}
}
```

### Create task (minimal)

```json
{
  "v": 1,
  "id": "create-1",
  "op": "task.create",
  "params": {
    "title": "Buy groceries",
    "idempotencyKey": "buy-groceries-1"
  }
}
```

### Create task with `dueISO`

```json
{
  "v": 1,
  "id": "create-2",
  "op": "task.create",
  "params": {
    "title": "Call dentist",
    "dueISO": "2026-03-05T15:30:00.000Z",
    "priority": 2,
    "idempotencyKey": "call-dentist-1"
  }
}
```

### Mark a task done

```json
{
  "v": 1,
  "id": "done-1",
  "op": "task.setStatus",
  "params": {
    "taskId": "task-123",
    "status": "done"
  }
}
```

### List open tasks

```json
{
  "v": 1,
  "id": "list-1",
  "op": "task.list",
  "params": {
    "status": "open",
    "limit": 50
  }
}
```
