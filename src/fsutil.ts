import { AbortController } from 'abort-controller'
import * as fs from "fs"
import * as json5 from "json5"
import fetch from "node-fetch"
import * as path from "path"
import { taskFileExtension } from "./patterns"
import { BebrasConfig, deepMerge, defaultBebrasConfig, fatalError, isArray, isRecord, isString } from "./util"
import hasbin = require("hasbin")

export function isTaskFile(path: string, ensureExistenceToo: boolean): boolean {
    if (!path.endsWith(taskFileExtension) || (ensureExistenceToo && !(fs.existsSync(path)))) {
        return false
    }
    return true
}

export function ensureIsTaskFile(path: string, ensureExistenceToo: boolean): string | never {
    if (!isTaskFile(path, ensureExistenceToo)) {
        fatalError(`not a${ensureExistenceToo ? "n existing" : ""} task file: ${path}`)
    }
    return path
}


export async function findTasksFilesOrEnsureIsTaskFile(source: string, recursive: boolean, pattern: string | false | undefined): Promise<{ taskFiles: string[], commonFolder: string }> {
    // returns an error or a list of task files
    if (recursive) {
        if (!fs.existsSync(source)) {
            fatalError("source folder does not exist: " + source)
        }
        if (!fs.lstatSync(source).isDirectory()) {
            fatalError("source folder is not a directory: " + source)
        }
        const hasFilter = isString(pattern) && pattern.length > 0
        const taskFiles = await findTaskFilesRecursively(source, hasFilter ? pattern.toLowerCase() : undefined)
        if (taskFiles.length === 0) {
            fatalError("no task file found in " + source + (hasFilter ? " matching filter '" + pattern + "'" : ""))
        }
        console.log(`Processing ${taskFiles.length} task file${taskFiles.length === 1 ? "" : "s"} from folder '${path.resolve(source)}'${hasFilter ? " matching filter '" + pattern + "'" : ""}...`)
        return { taskFiles, commonFolder: source }
    } else {
        ensureIsTaskFile(source, true)
        return { taskFiles: [source], commonFolder: path.dirname(source) }
    }
}

async function findTaskFilesRecursively(folder: string, patternLower: string | undefined): Promise<string[]> {
    const res: string[] = []
    for (const f of fs.readdirSync(folder)) {
        const fullPath = path.join(folder, f)
        if (fs.lstatSync(fullPath).isDirectory()) {
            res.push(...await findTaskFilesRecursively(fullPath, patternLower))
        } else {
            if (isTaskFile(fullPath, true) && (!patternLower || fullPath.toLowerCase().includes(patternLower))) {
                res.push(fullPath)
            }
        }
    }
    return res
}


export function siblingWithExtension(filepath: string, ext: string) {
    let filename = path.basename(filepath, taskFileExtension)
    filename = path.basename(filename, path.extname(filename))
    const siblingName = filename + ext
    return path.join(path.dirname(filepath), siblingName)
}


export async function modificationDateIsLater(source: string, derived: string): Promise<boolean> {
    const sourceStat = await fs.promises.stat(source)
    const derivedStat = await fs.promises.stat(derived)
    return sourceStat.mtimeMs > derivedStat.mtimeMs
}


export function toFileUrl(filepath: string): string {
    let pathName = path.resolve(filepath).replace(/\\/g, '/')

    // Windows drive letter must be prefixed with a slash
    if (pathName[0] !== '/') {
        pathName = '/' + pathName
    }

    return encodeURI('file://' + pathName)
}



export async function readFileStrippingBom(filepath: string): Promise<string> {
    let content = await fs.promises.readFile(filepath, "utf8")
    if (content.length > 0 && content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1)
        console.log("Warning: file was saved with a UTF-8 BOM, remove it for fewer unexpected results: " + filepath)
    }
    return content
}

export async function mkdirsOf(child: string): Promise<void> {
    const parent = path.dirname(child)

    if (!fs.existsSync(parent)) {
        await fs.promises.mkdir(parent, { recursive: true })
    }
}

export type WriteResultFile = { type: "file", file: string, wasUpToDate: boolean, desc: string }

export type WriteResult =
    | { type: "stdout" }
    | WriteResultFile
    | WriteResultFile[]

export type WriteResultSingle = Extract<WriteResult, { type: any }>

type WriteResultFor<O extends string | true> = O extends string ?
    Extract<WriteResult, { type: "file" }> :
    Extract<WriteResult, { type: "stdout" }>

export async function writeData<O extends string | true>(data: string | Buffer | Uint8Array, output: O, desc: string): Promise<WriteResultFor<O>> {
    if (isString(output)) {
        // file
        await mkdirsOf(output)
        // if file exists, check if it is up to date
        let wasUpToDate = false
        if (fs.existsSync(output)) {
            const dataAsBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
            const existingData = await fs.promises.readFile(output)
            if (Buffer.compare(dataAsBuffer, existingData) === 0) {
                wasUpToDate = true
            }
        }
        if (!wasUpToDate) {
            await fs.promises.writeFile(output, data)
        }
        return { type: "file", file: output, wasUpToDate, desc } satisfies WriteResultFor<string> as WriteResultFor<O>
    } else {
        // stdout
        console.log(data)
        return { type: "stdout" } satisfies WriteResultFor<true> as WriteResultFor<O>
    }
}

export function logWriteResult<R extends WriteResult>(result: R): R {
    if (isArray(result)) {
        for (const r of result) {
            logWriteResult(r)
        }
    } else if (result.type === "stdout") {
        // don't pollute stdout, nothing
    } else if (result.wasUpToDate) {
        console.log(`${result.desc} unchanged in ${result.file}`)
    } else {
        console.log(`${result.desc} written on ${result.file}`)
    }
    return result
}

export function isBinaryAvailable(binName: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        hasbin(binName, resolve)
    })
}

export async function urlExists(url: string, timeoutMs: number): Promise<boolean> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
        const response = await fetch(url, {
            method: "HEAD",
            signal: controller.signal,
        })
        return response.ok
    } catch {
        return false
    } finally {
        clearTimeout(timer)
    }
}

export function loadBebrasConfig(containingFolder: string): BebrasConfig {
    containingFolder = path.resolve(containingFolder)
    const loadedOptionsFiles: string[] = []
    const verbose = false

    function doLoad() {
        // walk up the directory tree to find config files and merge them
        let currentOptions: Partial<BebrasConfig> = {}
        for (let dir = containingFolder; dir !== path.dirname(dir); dir = path.dirname(dir)) {
            for (const filename of ["bebras_config.json", "rendering_options.json"]) {
                const optionsFilePath = path.join(dir, filename)
                if (verbose) {
                    console.log("looking for Bebras config in " + optionsFilePath)
                }
                if (fs.existsSync(optionsFilePath)) {
                    try {
                        const optionsJson = json5.parse(fs.readFileSync(optionsFilePath, "utf8"))
                        if (isRecord(optionsJson)) {
                            loadedOptionsFiles.push(optionsFilePath)
                            // merge options, with the closest to the task file taking precedence
                            currentOptions = deepMerge(optionsJson, currentOptions)
                        }
                    } catch (e) {
                        // ignore errors, use default options
                        console.error("Error loading config from " + optionsFilePath + ":\n  " + e)
                    }
                }
            }
        }

        return deepMerge(defaultBebrasConfig(), currentOptions)
    }

    const config = doLoad()
    if (verbose) {
        if (loadedOptionsFiles.length === 1) {
            console.log("config loaded from " + loadedOptionsFiles[0] + ":")
        } else if (loadedOptionsFiles.length > 0) {
            console.log("config merged and loaded from: ")
            for (const f of loadedOptionsFiles) {
                console.log("  " + f)
            }
        } else {
            console.log("no config found, using defaults: ")
        }
        console.log(JSON.stringify(config, null, 2))
    }
    return config as BebrasConfig
}