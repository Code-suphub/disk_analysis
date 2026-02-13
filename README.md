# Disk Space Analyzer

A cross-platform disk space analyzer with interactive visualization built using Electron and Python.

## Features

- Recursive directory scanning with progress indication
- Interactive treemap visualization using ECharts
- Detailed file and folder information
- Size-based filtering
- Cross-platform support (Windows, macOS, Linux)
- Multi-threaded scanning for better performance
- Export capabilities (coming soon)

## Requirements

- Node.js (v14 or later)
- Python 3.6 or later
- npm or yarn

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd disk-analyzer
```

2. Install Node.js dependencies:
```bash
npm install
```

3. No Python dependencies are required as the application only uses built-in Python modules.

## Development

To run the application in development mode:

```bash
npm run dev
```

This will start the application with DevTools enabled.

## Building

To build the application:

```bash
npm run build
```

This will create platform-specific builds in the `dist` directory.

## Usage

1. Launch the application
2. Click "Select Folder" to choose a directory to analyze
3. Wait for the scanning process to complete
4. Use the treemap visualization to explore disk usage:
   - Click on folders to zoom in
   - Use the breadcrumb navigation to go back
   - Use the size filter to focus on larger files/folders
5. View detailed information in the right panel by clicking on items

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
