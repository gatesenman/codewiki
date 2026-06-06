import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'

let mainWindow: BrowserWindow | null = null

const DIST = path.join(__dirname, '../dist')
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'CodeWiki',
    icon: path.join(__dirname, '../public/icon.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d1117',
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(DIST, 'index.html'))
  }

  mainWindow.on('closed', () => {
    closeAllWatchers()
    mainWindow = null
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// IPC Handlers

// Select local folder
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select Project Folder',
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

// Read directory tree
ipcMain.handle('read-directory', async (_event, dirPath: string) => {
  try {
    return readDirectoryRecursive(dirPath, dirPath, 0)
  } catch (err) {
    console.error('Error reading directory:', err)
    return []
  }
})

// Read file content
ipcMain.handle('read-file', async (_event, filePath: string) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return content
  } catch {
    return null
  }
})

// Write file content (for Code Agent modifications)
ipcMain.handle('write-file', async (_event, filePath: string, content: string) => {
  try {
    // Create backup before writing
    const backupPath = filePath + '.codewiki-backup'
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, backupPath)
    }
    fs.writeFileSync(filePath, content, 'utf-8')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// Apply partial file modification (line-based)
ipcMain.handle('apply-modification', async (
  _event,
  filePath: string,
  startLine: number,
  endLine: number,
  newContent: string,
  expectedOriginal: string,
) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')

    // Validate that originalContent matches
    const actualOriginal = lines.slice(startLine - 1, endLine).join('\n')
    if (expectedOriginal && actualOriginal.trim() !== expectedOriginal.trim()) {
      return {
        success: false,
        error: `Content mismatch at ${filePath}:${startLine}-${endLine}. File may have changed.`,
        expected: expectedOriginal.substring(0, 200),
        actual: actualOriginal.substring(0, 200),
      }
    }

    // Create backup
    const backupPath = filePath + '.codewiki-backup'
    fs.copyFileSync(filePath, backupPath)

    // Apply modification
    const newLines = newContent.split('\n')
    lines.splice(startLine - 1, endLine - startLine + 1, ...newLines)
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8')

    return { success: true, backupPath }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// Open external link
ipcMain.handle('open-external', async (_event, url: string) => {
  shell.openExternal(url)
})

// Get app data path for storing wiki data
ipcMain.handle('get-app-data-path', async () => {
  const dataPath = path.join(app.getPath('userData'), 'codewiki-data')
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true })
  }
  return dataPath
})

// Save wiki data
ipcMain.handle('save-wiki-data', async (_event, projectId: string, data: string) => {
  const dataPath = path.join(app.getPath('userData'), 'codewiki-data', projectId)
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true })
  }
  fs.writeFileSync(path.join(dataPath, 'wiki.json'), data, 'utf-8')
  return true
})

// Load wiki data
ipcMain.handle('load-wiki-data', async (_event, projectId: string) => {
  const filePath = path.join(app.getPath('userData'), 'codewiki-data', projectId, 'wiki.json')
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8')
  }
  return null
})

// Persist index snapshot (ontology + vectors + file manifest) keyed by project
ipcMain.handle('save-index-data', async (_event, cacheKey: string, data: string) => {
  try {
    const dir = path.join(app.getPath('userData'), 'codewiki-data', 'index-cache')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${cacheKey}.json`), data, 'utf-8')
    return true
  } catch (err) {
    console.error('Error saving index cache:', err)
    return false
  }
})

// Load index snapshot
ipcMain.handle('load-index-data', async (_event, cacheKey: string) => {
  const filePath = path.join(app.getPath('userData'), 'codewiki-data', 'index-cache', `${cacheKey}.json`)
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8')
  }
  return null
})

// ---- File watching (auto incremental reindex) ----
const projectWatchers = new Map<string, fs.FSWatcher>()
const watchDebounce = new Map<string, NodeJS.Timeout>()

function isWatchableChange(filename: string | null): boolean {
  if (!filename) return true // unknown file — be safe and trigger
  const parts = filename.split(/[/\\]/)
  if (parts.some(p => IGNORED_DIRS.has(p))) return false
  const base = parts[parts.length - 1]
  if (base.endsWith('.codewiki-backup')) return false
  const ext = path.extname(base).toLowerCase()
  return CODE_EXTENSIONS.has(ext) || base === 'Makefile' || base === 'Dockerfile'
}

function closeAllWatchers() {
  for (const w of projectWatchers.values()) w.close()
  projectWatchers.clear()
  for (const t of watchDebounce.values()) clearTimeout(t)
  watchDebounce.clear()
}

ipcMain.handle('watch-project', async (_event, folderPath: string) => {
  if (projectWatchers.has(folderPath)) return true
  try {
    const watcher = fs.watch(folderPath, { recursive: true }, (_eventType, filename) => {
      if (!isWatchableChange(filename as string | null)) return
      const existing = watchDebounce.get(folderPath)
      if (existing) clearTimeout(existing)
      // Debounce bursts of edits into a single change notification.
      watchDebounce.set(folderPath, setTimeout(() => {
        watchDebounce.delete(folderPath)
        mainWindow?.webContents.send('project-files-changed', folderPath)
      }, 600))
    })
    watcher.on('error', err => console.error('Project watcher error:', err))
    projectWatchers.set(folderPath, watcher)
    return true
  } catch (err) {
    console.error('Failed to watch project:', err)
    return false
  }
})

ipcMain.handle('unwatch-project', async (_event, folderPath: string) => {
  const w = projectWatchers.get(folderPath)
  if (w) { w.close(); projectWatchers.delete(folderPath) }
  const t = watchDebounce.get(folderPath)
  if (t) { clearTimeout(t); watchDebounce.delete(folderPath) }
  return true
})

const MAX_CMD_OUTPUT = 200_000 // cap captured output per stream (~200KB)

// Run a project command (tests/build/lint) in a child process with a timeout.
// Only commands the user configured in Settings are ever passed here.
ipcMain.handle('run-command', async (_event, cwd: string, command: string, timeoutMs: number) => {
  return await new Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }>(resolve => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const finish = (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode, stdout, stderr, timedOut })
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, { cwd, shell: true, windowsHide: true })
    } catch (err) {
      resolve({ exitCode: null, stdout: '', stderr: String(err), timedOut: false })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, Math.max(1000, timeoutMs || 120000))
    child.stdout?.on('data', d => { if (stdout.length < MAX_CMD_OUTPUT) stdout += d.toString() })
    child.stderr?.on('data', d => { if (stderr.length < MAX_CMD_OUTPUT) stderr += d.toString() })
    child.on('error', err => { stderr += String(err); finish(null) })
    child.on('close', code => finish(code))
  })
})

interface FileNode {
  name: string
  path: string
  relativePath: string
  type: 'file' | 'directory'
  children?: FileNode[]
  extension?: string
  size?: number
  mtimeMs?: number
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out',
  '.next', '.nuxt', '__pycache__', '.pytest_cache', '.mypy_cache',
  'target', 'bin', 'obj', '.idea', '.vscode', '.vs', 'coverage',
  '.turbo', '.cache', 'tmp', 'temp',
])

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp',
  '.h', '.hpp', '.cs', '.rb', '.php', '.swift', '.kt', '.scala', '.vue',
  '.svelte', '.astro', '.md', '.mdx', '.json', '.yaml', '.yml', '.toml',
  '.xml', '.html', '.css', '.scss', '.less', '.sql', '.sh', '.bash',
  '.dockerfile', '.proto', '.graphql', '.prisma',
])

function readDirectoryRecursive(dirPath: string, basePath: string, depth: number): FileNode[] {
  if (depth > 8) return []
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  const nodes: FileNode[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue
    const fullPath = path.join(dirPath, entry.name)
    const relativePath = path.relative(basePath, fullPath)

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      const children = readDirectoryRecursive(fullPath, basePath, depth + 1)
      if (children.length > 0) {
        nodes.push({
          name: entry.name,
          path: fullPath,
          relativePath,
          type: 'directory',
          children,
        })
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (CODE_EXTENSIONS.has(ext) || entry.name === 'Makefile' || entry.name === 'Dockerfile') {
        const stats = fs.statSync(fullPath)
        if (stats.size < 500000) {
          nodes.push({
            name: entry.name,
            path: fullPath,
            relativePath,
            type: 'file',
            extension: ext,
            size: stats.size,
            mtimeMs: stats.mtimeMs,
          })
        }
      }
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}
