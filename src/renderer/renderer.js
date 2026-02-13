const { ipcRenderer } = require('electron');

// Language translations
const translations = {
    cn: {
        title: '磁盘空间分析器',
        selectFolder: '选择文件夹',
        minimumSize: '最小大小 (MB):',
        applyFilter: '应用过滤',
        treemapView: '树形图视图',
        treeView: '树形列表',
        details: '详细信息',
        scanning: '扫描中...',
        scanComplete: '扫描完成！',
        processed: '已处理',
        files: '个文件',
        remaining: '剩余',
        filesPerSecond: '文件/秒',
        path: '路径',
        size: '大小',
        modified: '修改时间',
        created: '创建时间',
        fileCount: '文件数量',
        error: '错误'
    },
    en: {
        title: 'Disk Space Analyzer',
        selectFolder: 'Select Folder',
        minimumSize: 'Minimum size (MB):',
        applyFilter: 'Apply Filter',
        treemapView: 'Treemap View',
        treeView: 'Tree View',
        details: 'Details',
        scanning: 'Scanning...',
        scanComplete: 'Scan complete!',
        processed: 'Processed',
        files: 'files',
        remaining: 'remaining',
        filesPerSecond: 'files/sec',
        path: 'Path',
        size: 'Size',
        modified: 'Modified',
        created: 'Created',
        fileCount: 'Files',
        error: 'Error'
    }
};

// Current language
let currentLang = 'cn';

// Get translation
function t(key) {
    return translations[currentLang][key] || translations.en[key] || key;
}

// Update UI language
function updateUILanguage() {
    // Update title
    document.querySelector('h1').textContent = t('title');
    
    // Update buttons
    document.getElementById('selectFolder').textContent = t('selectFolder');
    document.getElementById('applyFilter').textContent = t('applyFilter');
    document.getElementById('treemapView').textContent = t('treemapView');
    document.getElementById('treeView').textContent = t('treeView');
    
    // Update labels
    document.querySelector('label[for="sizeFilter"]').textContent = t('minimumSize');
    document.querySelector('#details h2').textContent = t('details');

    // Update current view if data exists
    if (currentData) {
        if (currentView === 'treemap') {
            updateTreemap(filteredData);
        } else {
            updateTreeView(currentData);
        }
        const nodeData = findNode(currentData, currentData.path);
        if (nodeData) {
            updateDetails(nodeData);
        }
    }
}

// Initialize language switch
const languageSwitch = document.getElementById('languageSwitch');
languageSwitch.addEventListener('click', () => {
    currentLang = currentLang === 'cn' ? 'en' : 'cn';
    languageSwitch.classList.toggle('en', currentLang === 'en');
    updateUILanguage();
});

// Initialize ECharts
const chart = echarts.init(document.getElementById('treemap'));
let currentData = null;
let filteredData = null;
let currentView = 'treemap'; // Track current view mode

// Format bytes to human readable format
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

// Format timestamp to date
function formatDate(timestamp) {
    return new Date(timestamp * 1000).toLocaleString();
}

// Format time duration
function formatDuration(seconds) {
    if (seconds < 60) {
        return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.round(seconds % 60);
        return `${minutes}m ${remainingSeconds}s`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${minutes}m`;
    }
}

// Convert scan data to ECharts format
function convertToTreemapData(data, minSize = 0) {
    function processNode(node) {
        const result = {
            name: node.name,
            path: node.path,
            value: node.size,
            children: []
        };

        if (node.children) {
            for (const child of node.children) {
                if (child.size >= minSize * 1024 * 1024) { // Convert MB to bytes
                    const processedChild = processNode(child);
                    if (processedChild) {
                        result.children.push(processedChild);
                    }
                }
            }
        }

        return result.children.length > 0 || node.size >= minSize * 1024 * 1024 ? result : null;
    }

    return processNode(data);
}

// Update the treemap visualization
function updateTreemap(data) {
    const option = {
        title: {
            text: 'Disk Space Usage',
            left: 'center'
        },
        tooltip: {
            formatter: function(info) {
                const value = formatBytes(info.value);
                const name = info.name;
                return `${name}<br/>Size: ${value}`;
            }
        },
        series: [{
            type: 'treemap',
            data: [data],
            label: {
                show: true,
                formatter: function(params) {
                    return `${params.name}\n${formatBytes(params.value)}`;
                }
            },
            breadcrumb: {
                show: true
            }
        }]
    };

    chart.setOption(option);
}

// Update details panel
function updateDetails(data) {
    const detailsDiv = document.getElementById('selected-item-details');
    const details = `
        <h3>${data.name}</h3>
        <p><strong>${t('path')}:</strong> ${data.path}</p>
        <p><strong>${t('size')}:</strong> ${formatBytes(data.size)}</p>
        ${data.type === 'file' ? `
            <p><strong>${t('modified')}:</strong> ${formatDate(data.modified)}</p>
            <p><strong>${t('created')}:</strong> ${formatDate(data.created)}</p>
        ` : `
            <p><strong>${t('fileCount')}:</strong> ${data.file_count}</p>
        `}
    `;
    detailsDiv.innerHTML = details;
}

// Calculate percentage of parent size
function calculatePercentage(size, parentSize) {
    return parentSize > 0 ? (size / parentSize * 100) : 0;
}

// Create tree node HTML
function createTreeNode(node, parentSize = node.size) {
    const div = document.createElement('div');
    div.className = `tree-node ${node.type}`;
    div.dataset.path = node.path;

    // Create node content container
    const nodeContent = document.createElement('div');
    nodeContent.className = 'tree-node-content';

    // Add expand/collapse button for directories
    const expandButton = document.createElement('span');
    expandButton.className = 'expand-button';
    
    if (node.type === 'directory' && node.children && node.children.length > 0) {
        expandButton.textContent = '▶';
        expandButton.style.cursor = 'pointer';
        expandButton.onclick = (e) => {
            e.stopPropagation();
            const nodeElement = e.target.closest('.tree-node');
            nodeElement.classList.toggle('expanded');
            expandButton.textContent = nodeElement.classList.contains('expanded') ? '▼' : '▶';
        };
    } else {
        expandButton.innerHTML = '&nbsp;';
        expandButton.style.cursor = 'default';
    }
    nodeContent.appendChild(expandButton);

    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = node.type === 'directory' ? '📁' : '📄';
    nodeContent.appendChild(icon);

    const content = document.createElement('div');
    content.className = 'content';

    // 创建文件名容器
    const nameContainer = document.createElement('div');
    nameContainer.className = 'name-container';
    nameContainer.style.flex = '1';
    nameContainer.style.minWidth = '0';
    nameContainer.style.overflow = 'hidden';
    nameContainer.style.textOverflow = 'ellipsis';
    nameContainer.style.whiteSpace = 'nowrap';

    // 添加文件名
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = decodeURIComponent(node.name); // 解码文件名，确保正确显示中文
    nameContainer.appendChild(name);
    content.appendChild(nameContainer);

    // 添加大小信息
    const size = document.createElement('span');
    size.className = 'size';
    size.textContent = formatBytes(node.size);
    content.appendChild(size);

    // Add disk usage bar
    const usageBar = document.createElement('div');
    usageBar.className = 'disk-usage-bar';
    const usageFill = document.createElement('div');
    usageFill.className = 'disk-usage-fill';
    usageFill.style.width = `${calculatePercentage(node.size, parentSize)}%`;
    usageBar.appendChild(usageFill);
    content.appendChild(usageBar);

    nodeContent.appendChild(content);
    div.appendChild(nodeContent);

    if (node.type === 'directory' && node.children && node.children.length > 0) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'children';
        
        node.children.sort((a, b) => {
            // Directories first, then files
            if (a.type === 'directory' && b.type !== 'directory') return -1;
            if (a.type !== 'directory' && b.type === 'directory') return 1;
            // Then sort by size
            return b.size - a.size;
        }).forEach(child => {
            childrenContainer.appendChild(createTreeNode(child, node.size));
        });

        div.appendChild(childrenContainer);
    }

    // Add click handler for the content area
    content.onclick = (e) => {
        e.stopPropagation();
        const nodeData = findNode(currentData, node.path);
        if (nodeData) {
            updateDetails(nodeData);
            
            // If it's a directory, also toggle expansion
            if (nodeData.type === 'directory' && nodeData.children && nodeData.children.length > 0) {
                div.classList.toggle('expanded');
                const button = div.querySelector('.expand-button');
                if (button) {
                    button.textContent = div.classList.contains('expanded') ? '▼' : '▶';
                }
            }
        }
    };

    return div;
}

// Update tree view
function updateTreeView(data) {
    const treeview = document.getElementById('treeview');
    treeview.innerHTML = '';
    treeview.appendChild(createTreeNode(data));

    // Add click handlers
    treeview.querySelectorAll('.tree-node').forEach(node => {
        node.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent event bubbling
            
            const path = node.dataset.path;
            const nodeData = findNode(currentData, path);
            if (nodeData) {
                updateDetails(nodeData);
            }

            if (node.classList.contains('folder')) {
                node.classList.toggle('expanded');
            }
        });
    });
}

// Switch view mode
function switchView(mode) {
    const treemapView = document.getElementById('treemapView');
    const treeView = document.getElementById('treeView');
    const treemap = document.getElementById('treemap');
    const treeview = document.getElementById('treeview');

    treemapView.classList.toggle('active', mode === 'treemap');
    treeView.classList.toggle('active', mode === 'tree');
    
    treemap.style.display = mode === 'treemap' ? 'block' : 'none';
    treeview.style.display = mode === 'tree' ? 'block' : 'none';

    if (mode === 'treemap') {
        chart.resize();
    }

    currentView = mode;
}

// Handle folder selection
document.getElementById('selectFolder').addEventListener('click', async () => {
    const dirPath = await ipcRenderer.invoke('select-directory');
    if (!dirPath) return;

    // Show progress container
    const progressContainer = document.querySelector('.progress-container');
    const progressBar = document.querySelector('.progress');
    const progressText = document.getElementById('progress-text');
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';

    try {
        // Start scanning
        currentData = await ipcRenderer.invoke('scan-directory', dirPath);
        filteredData = convertToTreemapData(currentData);
        updateTreemap(filteredData);
        updateTreeView(currentData);
        
        // Show treemap by default
        switchView('treemap');
    } catch (error) {
        console.error('Scanning error:', error);
        progressText.textContent = `Error: ${error.message}`;
        progressText.classList.add('error');
    } finally {
        progressContainer.style.display = 'none';
    }
});

// Handle view switching
document.getElementById('treemapView').addEventListener('click', () => switchView('treemap'));
document.getElementById('treeView').addEventListener('click', () => switchView('tree'));

// Handle progress updates
ipcRenderer.on('scan-progress', (event, progress) => {
    const progressContainer = document.querySelector('.progress-container');
    const progressBar = document.querySelector('.progress');
    
    progressContainer.style.display = 'block';

    if (progress.status === 'error') {
        console.error(`${t('error')}: ${progress.message}`);
        return;
    }

    if (progress.status === 'starting' || progress.status === 'complete' || progress.percent !== undefined) {
        progressBar.style.width = progress.status === 'complete' ? '100%' : `${progress.percent || 0}%`;
        updateProgressText(progress);
    }
});

// Handle size filter
document.getElementById('applyFilter').addEventListener('click', () => {
    if (!currentData) return;
    const minSize = parseFloat(document.getElementById('sizeFilter').value) || 0;
    filteredData = convertToTreemapData(currentData, minSize);
    
    if (currentView === 'treemap') {
        updateTreemap(filteredData);
    } else {
        updateTreeView(currentData); // For tree view, we'll show all items but update their visibility
    }
});

// Handle window resize
window.addEventListener('resize', () => {
    chart.resize();
});

// Update progress text with translations
function updateProgressText(progress) {
    const progressText = document.getElementById('progress-text');
    if (progress.status === 'starting') {
        progressText.textContent = `${t('scanning')} ${t('found')} ${progress.total.toLocaleString()} ${t('files')}`;
    } else if (progress.status === 'complete') {
        progressText.textContent = `${t('scanComplete')} ${t('processed')} ${progress.total.toLocaleString()} ${t('files')} in ${formatDuration(progress.elapsed)}`;
    } else {
        const filesPerSecond = progress.processed / progress.elapsed;
        const remainingTime = formatDuration(progress.estimated_remaining);
        progressText.textContent = `${t('scanning')} ${progress.percent.toFixed(1)}% (${progress.processed.toLocaleString()}/${progress.total.toLocaleString()} ${t('files')})
            ${Math.round(filesPerSecond)} ${t('filesPerSecond')}, ${remainingTime} ${t('remaining')}`;
    }
}

// Initialize UI language
updateUILanguage();
