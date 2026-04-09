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

## Example output

```text
Breakdown
  used                     101k tok    37.2%
    system prompt          1.4k tok     0.5%  5,401 chars, approx
      skills advertised       2
    summarized history        0 tok     0.0%  0 compactions, 0 branch summaries, approx
    message context       99.9k tok    36.7%  latest captured request, approx
      user                 1.3k tok     0.5%  31 messages
      assistant text      10.0k tok     3.7%  101 messages
      thinking             9.7k tok     3.6%  88 blocks
      tool calls          34.7k tok    12.8%  104 calls
      tool results        43.9k tok    16.1%  104 messages
      bash execution        259 tok     0.1%  13 messages
  free                     171k tok    62.8%
  --------------------------------------------------------
  context window           272k tok   100.0%
```