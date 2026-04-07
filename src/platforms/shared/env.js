const fs = require("node:fs/promises");
const path = require("node:path");

const ENV_FILE_NAMES = Object.freeze([".env", ".env.local"]);

let cachedLoadPromise = null;

function stripBom(text) {
    if (text.charCodeAt(0) === 0xfeff) {
        return text.slice(1);
    }
    return text;
}

function parseEnvValue(rawValue) {
    const trimmedValue = rawValue.trim();
    if (trimmedValue === "") {
        return "";
    }

    const firstChar = trimmedValue[0];
    const lastChar = trimmedValue[trimmedValue.length - 1];
    if ((firstChar === "\"" && lastChar === "\"") || (firstChar === "'" && lastChar === "'")) {
        const innerValue = trimmedValue.slice(1, -1);
        if (firstChar === "\"") {
            return innerValue
                .replace(/\\n/g, "\n")
                .replace(/\\r/g, "\r")
                .replace(/\\t/g, "\t")
                .replace(/\\"/g, "\"")
                .replace(/\\\\/g, "\\");
        }
        return innerValue;
    }

    return trimmedValue;
}

function parseEnvText(content) {
    const parsed = {};
    const lines = stripBom(content).split(/\r?\n/);

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) {
            continue;
        }

        const match = rawLine.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!match) {
            continue;
        }

        const [, key, rawValue] = match;
        parsed[key] = parseEnvValue(rawValue);
    }

    return parsed;
}

function resolveProjectRoot() {
    return path.resolve(__dirname, "..", "..", "..");
}

// 只在第一次调用时读取本地环境文件，避免重复 I/O；
// 命令行或系统环境变量始终优先，不会被 .env / .env.local 覆盖。
async function loadProjectEnvFiles() {
    const projectRoot = resolveProjectRoot();
    const mergedValues = {};
    const loadedFiles = [];

    for (const fileName of ENV_FILE_NAMES) {
        const filePath = path.join(projectRoot, fileName);
        try {
            const content = await fs.readFile(filePath, "utf8");
            Object.assign(mergedValues, parseEnvText(content));
            loadedFiles.push(filePath);
        } catch (error) {
            if (error && error.code !== "ENOENT") {
                throw error;
            }
        }
    }

    for (const [key, value] of Object.entries(mergedValues)) {
        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }

    return loadedFiles;
}

function ensureProjectEnvLoaded() {
    if (!cachedLoadPromise) {
        cachedLoadPromise = loadProjectEnvFiles();
    }
    return cachedLoadPromise;
}

module.exports = {
    ensureProjectEnvLoaded,
    loadProjectEnvFiles
};
