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

