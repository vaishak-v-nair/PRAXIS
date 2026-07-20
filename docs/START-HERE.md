# Never used a terminal? Start here.

PRAXIS is installed by typing one line into a *terminal*. If you've never done
that, this page gets you there in five minutes — no prior knowledge assumed.

## What is a terminal?

A terminal is just a window where you type commands instead of clicking
buttons. You type a line, press **Enter**, the computer does it and prints the
result. That's the whole concept.

## Where is my terminal?

You already have one. Pick whichever matches how you work — **they are all the
same terminal**, and PRAXIS works identically in every one of them:

| Where you work | How to open the terminal |
|---|---|
| **VS Code** | Press <kbd>Ctrl</kbd>+<kbd>`</kbd> (the backtick key, above Tab) — a panel opens at the bottom |
| **Cursor** | Same: <kbd>Ctrl</kbd>+<kbd>`</kbd> |
| **Antigravity / other AI editors** | Look for a *Terminal* menu or panel — every code editor has one |
| **Windows, no editor** | Press <kbd>Win</kbd>, type `terminal`, press Enter |
| **Mac, no editor** | Press <kbd>Cmd</kbd>+<kbd>Space</kbd>, type `terminal`, press Enter |

> The window looking different (colors, fonts, the text before the cursor) is
> normal. What matters is only what **you** type.

## Step 1 — check you have Node

In the terminal, type this and press Enter:

```
node --version
```

- See something like `v20.11.0`? You're ready — go to Step 2.
- See an error? Install Node first: <https://nodejs.org> → big green button →
  run the installer → **close and reopen your terminal** → try again.

## Step 2 — install PRAXIS

```
npm install -g praxis-memory
```

Wait for it to finish (a few seconds), then in the folder of your project type:

```
praxis
```

(Skipping the install? `npx praxis-memory` does the same thing — everything
still works; just write `npx praxis-memory` wherever you see `praxis` below.)

## Step 3 — what success looks like

PRAXIS prints a welcome, sets itself up, and from then on it works in the
background: every Claude Code session in that folder is remembered, and the
axolotl appears in your system tray (Windows). You don't have to remember any
commands — that's the point.

Three you might still enjoy:

```
praxis status    # what PRAXIS remembers about this project
praxis hud       # your Claude session, retold in plain English (second terminal)
praxis feedback  # tell us what would make PRAXIS worth paying for
```

## Something broke?

- `praxis feedback` opens a pre-filled form in your browser — just type and submit.
- No GitHub account? Email **vaishak.v.nair.dev@gmail.com** with what you saw.

That's it. You've used a terminal.
