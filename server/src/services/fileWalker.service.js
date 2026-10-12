import fs from "fs/promises";
import path from "path";

// Directories that should always be excluded from scanning
const DEFAULT_IGNORED_DIRS = new Set([
    "node_modules",
    ".git",
    ".github",
    ".husky",
    "dist",
    "build",
    "coverage",
    ".next",
    ".turbo",
    ".cache",
    ".vscode",
    ".idea",
]);

// Binary / media / archive / lockfile extensions to ignore
const IGNORED_EXTENSIONS = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
    ".woff", ".woff2", ".ttf", ".eot",
    ".zip", ".tar", ".gz", ".rar",
    ".mp3", ".mp4", ".mov", ".avi",
    ".exe", ".dll", ".so", ".dylib",
    ".pdf", ".doc", ".docx",
    ".map",
]);

// Specific filenames that should not be parsed
const IGNORED_FILENAMES = new Set([
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    ".DS_Store",
    "Thumbs.db",
]);

// Source code extensions supported for AST parsing
const SUPPORTED_CODE_EXTENSIONS = new Set([
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".mjs",
    ".cjs",
]);

// Maximum file size in bytes (1MB) to prevent memory crashes on minified bundles
const MAX_FILE_SIZE_BYTES = 1024 * 1024;

/**
 * Checks whether a given directory name should be ignored
 * @param {string} dirName
 * @returns {boolean}
 */
export const shouldIgnoreDir = (dirName) => {
    return DEFAULT_IGNORED_DIRS.has(dirName) || dirName.startsWith(".");
};

/**
 * Checks whether a given file should be ignored from code analysis
 * @param {string} fileName
 * @param {number} sizeInBytes
 * @returns {boolean}
 */
export const shouldIgnoreFile = (fileName, sizeInBytes = 0) => {
    if (IGNORED_FILENAMES.has(fileName)) return true;
    if (sizeInBytes > MAX_FILE_SIZE_BYTES) return true;

    const ext = path.extname(fileName).toLowerCase();
    if (IGNORED_EXTENSIONS.has(ext)) return true;

    return false;
};

/**
 * Checks if the file is a source code file eligible for AST parsing
 * @param {string} filePath
 * @returns {boolean}
 */
export const isSupportedCodeFile = (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    return SUPPORTED_CODE_EXTENSIONS.has(ext);
};

/**
 * Recursively walks a directory and returns a flat list of discovered files
 * @param {string} rootDir - The root directory to walk
 * @param {string} currentDir - Current recursive directory
 * @returns {Promise<Array<{ absolutePath: string, relativePath: string, fileName: string, extension: string, size: number, isCode: boolean }>>}
 */
export const walkDirectory = async (rootDir, currentDir = rootDir) => {
    let files = [];

    let entries;
    try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
        console.warn(`[FileWalker] Could not read directory ${currentDir}:`, error.message);
        return files;
    }

    for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
            if (shouldIgnoreDir(entry.name)) {
                continue;
            }
            // Recurse into sub-directory
            const subDirFiles = await walkDirectory(rootDir, fullPath);
            files = files.concat(subDirFiles);
        } else if (entry.isFile()) {
            let stats;
            try {
                stats = await fs.stat(fullPath);
            } catch {
                stats = { size: 0 };
            }

            if (shouldIgnoreFile(entry.name, stats.size)) {
                continue;
            }

            const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, "/");

            files.push({
                absolutePath: fullPath,
                relativePath,
                fileName: entry.name,
                extension: path.extname(entry.name).toLowerCase(),
                size: stats.size,
                isCode: isSupportedCodeFile(entry.name),
            });
        }
    }

    return files;
};

export default {
    walkDirectory,
    shouldIgnoreDir,
    shouldIgnoreFile,
    isSupportedCodeFile,
};
