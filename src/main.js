const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { PythonShell } = require('python-shell');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
    
    // Open DevTools in development
    if (process.argv.includes('--debug')) {
        mainWindow.webContents.openDevTools();
    }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Handle folder selection
ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    return result.filePaths[0];
});

// Handle directory scanning
ipcMain.handle('scan-directory', async (event, dirPath) => {
    return new Promise((resolve, reject) => {
        let pyshell = new PythonShell(path.join(__dirname, '../backend/scanner.py'), {
            mode: 'json',
            args: [dirPath]
        });

        pyshell.on('message', (message) => {
            // If message is a progress update
            if (message.processed !== undefined) {
                mainWindow.webContents.send('scan-progress', message);
            } else {
                // Final result
                resolve(message);
            }
        });

        pyshell.on('error', (err) => {
            reject(err);
        });

        pyshell.end((err) => {
            if (err) reject(err);
        });
    });
});
