# pi-context-inspect

Diagnostic extension for Pi Coding Agent. Shows a breakdown of the current context window usage.

## Install

Local development:

```bash
pi install /home/algal/gits/pi-context-inspect
```

From GitHub:

```bash
pi install git:github.com/algal/pi-context-inspect
```

## Usage

After installing, reload Pi:

```bash
/reload
```

Then send one normal prompt so the extension can capture the latest request context, and run:

```bash
/context-inspect
```

Shows:
- Current context window usage vs. window limit
- System prompt contribution
- Summarized history contribution
- Message context split into user / assistant text / thinking / tool calls / tool results
- Free context remaining

## Accuracy

- Uses Pi's current context usage when available
- Breaks down the latest captured request context when possible
- Falls back to current-branch reconstruction if no request has been captured yet
- Per-layer subtotals are still estimates; Pi does not expose exact built-in per-layer token accounting