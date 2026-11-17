# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

磁盘空间分析器 (Disk Space Analyzer) - A cross-platform desktop application for visualizing disk usage, built with Electron and Python.

## Development Commands

```bash
# Install dependencies
npm install

# Run in development mode (with DevTools)
npm run dev

# Build for current platform
npm run build

# Build for specific platforms
npm run build:mac
npm run build:win
npm run build:linux
npm run build:all    # Build for all platforms
```

## Architecture

### Tech Stack
- **Frontend**: Electron (main + renderer processes), ECharts for treemap visualization
- **Backend**: Python 3.6+ with only built-in modules (no external dependencies)
- **Communication**: IPC between main/renderer, PythonShell for Node-Python communication

### Directory Structure
```
src/
  main.js              # Electron main process, IPC handlers, Python integration
  renderer/
    index.html         # Main UI layout
    renderer.js        # Frontend logic, tree/treemap views, task management
backend/
  scanner.py           # Python scanner, disk info, directory listing, size calculation
discuss/               # Design docs and architecture discussions
```

### Key Architecture Patterns

**Incremental Scanning**: The app uses on-demand/incremental scanning instead of full recursive scans:
- Initial scan only returns direct children of a directory
- Child directory sizes are calculated and streamed progressively
- User must click to expand folders, which triggers new scans

**Streaming Communication**: Python backend streams results via stdout as JSON lines:
- `type: 'structure'` - Initial directory structure (immediate)
- `type: 'size_update'` - Individual file/folder size updates
- `type: 'size_batch'` - Batch size updates from `du -d 1` command
- `type: 'status'` - Progress messages
- `type: 'error'` - Error messages

**Concurrent Task Management**:
- Max concurrent scans limited (default 3, configurable in UI)
- Active scanners tracked in `activeScanners` Map in main.js
- Task sidebar shows running scans with elapsed time
- Reaching limit shows modal with current load (n/m tasks)

**Admin Mode**: Supports elevated privileges via sudo-prompt:
- Toggle in UI enables `isAdminMode` flag
- When enabled, Python commands run with sudo (non-streaming, waits for completion)
- Normal mode uses PythonShell with streaming JSON mode

### Platform-Specific Optimizations

**macOS/Linux**:
- Uses `du -d 1 -k` for fast batch size calculation
- Uses `df -Pk` for disk information
- Filters system volumes to avoid duplicates (filters devfs, internal macOS volumes)

**Windows**:
- Uses `ctypes.windll.kernel32.GetLogicalDrives()` for disk enumeration
- Falls back to Python `os.scandir()` for size calculation (no native `du`)

### IPC Channels

Main process exposes these handlers:
- `select-directory` - Open folder dialog
- `get-disks` - Get disk usage overview
- `scan-directory` - Start directory scan (returns structure immediately, streams sizes)
- `cancel-scans` - Kill all active PythonShell processes
- `get-active-tasks` - List running scan tasks
- `update-concurrency` - Change max concurrent scans
- `toggle-admin` - Enable/disable admin mode
- `open-path` - Open file/folder in system explorer

Events pushed from main to renderer:
- `scan-update` - Size/progress updates during scan
- `task-finished` - Scan completion notification

## Important Notes

- Python backend only uses built-in modules (no pip install needed)
- UI supports Chinese (default) and English language switching
- Max concurrency setting persists in localStorage
- Tree view and treemap view are synchronized - selecting in one highlights in other
