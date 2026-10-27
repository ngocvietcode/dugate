# Cross-Platform Compatibility Notes

> Related default skills: `powershell-windows`, `bash-linux`
> Always check platform before running shell commands.

## Platform Detection
- Check `sys.platform` (Python) or `$env:OS` (PowerShell) or `uname` (Bash)
- Windows: `win32` | Linux: `linux` | macOS: `darwin`
- Use `powershell-windows` skill on Windows, `bash-linux` on Linux/macOS

## Path Separators
- Windows: backslash (\\), PowerShell also supports forward slash
- Linux/macOS: forward slash (/)
- Best practice: Use forward slash in code, let runtime handle conversion

## Shell Commands
- Windows: Use `powershell-windows` skill for PS patterns and pitfalls  
- Linux/macOS: Use `bash-linux` skill for Bash patterns and piping
- Avoid: `rm -rf` on Windows (use `Remove-Item -Recurse -Force`)
- Avoid: PowerShell-specific operators on Linux (use POSIX-compliant alternatives)

## Line Endings
- Windows: CRLF (\\r\\n)
- Linux/macOS: LF (\\n)
- Always: Configure `.gitattributes` with `* text=auto`

## Environment Variables
- Windows: `$env:VAR_NAME` (PowerShell), `%VAR_NAME%` (CMD)
- Linux/macOS: `$VAR_NAME` or `${VAR_NAME}`
- Best practice: Use dotenv files for consistency across platforms

## Encoding
- Windows: Default console is cp1252, may fail on emoji/Unicode
- Fix: Set `PYTHONIOENCODING=utf-8` or use `sys.stdout.reconfigure(encoding='utf-8')`
- Git: Ensure `core.quotepath=false` for UTF-8 filenames

## File Permissions
- Windows: ACL-based, no chmod equivalent needed for most cases
- Linux/macOS: chmod required for scripts (`chmod +x script.sh`)
- Best practice: Set executable bit in git with `git update-index --chmod=+x`

## Common Pitfalls
- Windows paths with spaces: Always quote paths
- Case sensitivity: Windows is case-insensitive, Linux is case-sensitive
- Max path length: Windows has 260 char limit (enable long paths via registry)
- Script shebang: `#!/usr/bin/env bash` not applicable on Windows
- npm/pip paths: Windows may need `--user` flag or admin privileges
