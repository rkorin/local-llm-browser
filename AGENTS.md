# Agent Notes

# AGENTS.md

## Environment

This project is on Windows.

Use PowerShell commands only.
Do not use bash, sh, sed, awk, grep, cat, or Linux-style commands unless explicitly available.

Use:
- `Get-Content` instead of `cat`
- `Get-ChildItem` instead of `ls -R`
- `rg` for search if available
- if `rg` is not available, use `Get-ChildItem -Recurse -File | Select-String`
- `py -3` instead of `python`

- Preferred environment bootstrap:
  (C:\\Users\\rkorin\\miniconda3\\shell\\condabin\\conda-hook.ps1) ; (conda activate tf)
  
- `where.exe` to check commands

Do not use `apply_patch`.
Edit files directly through Codex file editing/diff tools.

## Project commands

Use only commands that exist in this repo.
Do not invent test/build commands.

If unsure, inspect `package.json`, `.csproj`, `.sln`, or README first.
## Event Bus Contract

Any object or class that accepts an `eventBus` must begin with a precise top-level description of its event contract.

This is mandatory.

The description must explicitly list:
- what events it accepts / subscribes to
- what events it emits / publishes

Do not omit this.
Do not replace it with vague prose.
When changing event-driven behavior, update this description in the same edit.
## Presenter Screen States

Any presenter that reacts to orchestration or event-bus activity should describe its screens or presenter-states at the top of the file.

This is strongly preferred and should be treated as the default architecture style.

The description should make clear:
- which screens/states the presenter has
- which events can move it from one screen/state to another
- which events it listens to while in those screens/states
- what it emits as user intent back into the bus

Implementation rule:
- a presenter should not blindly apply every incoming event to the UI
- it should first know which screen/state it is currently rendering
- then decide whether the incoming event is relevant to that screen/state

Diagnostics rule:
- presenter design should preserve the ability to debug bad UI output from:
  - the event log seen by the presenter
  - the presenter screen-state transition log
- the intended mental model is:
  current presenter screen/state + incoming event -> apply or ignore -> visual update
