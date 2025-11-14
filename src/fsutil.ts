import { AbortController } from 'abort-controller'
import * as fs from "fs"
import fetch from "node-fetch"
import * as path from "path"
import { taskFileExtension } from "./patterns"
import { fatalError, isString } from "./util"
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


export async function findTasksFilesOrEnsureIsTaskFile(source: string, recursive: boolean, pattern: string | undefined): Promise<string[]> {
    // returns an error or a list of task files
    if (recursive) {
        if (!fs.existsSync(source)) {
            fatalError("source folder does not exist: " + source)
        }
        if (!fs.lstatSync(source).isDirectory()) {
            fatalError("source folder is not a directory: " + source)
        }
        return findTaskFilesRecursively(source, pattern)
    } else {
        ensureIsTaskFile(source, true)
        return [source]
    }
}

export async function findTaskFilesRecursively(folder: string, pattern: string | undefined): Promise<string[]> {
    const res: string[] = []
    for (const f of fs.readdirSync(folder)) {
        const fullPath = path.join(folder, f)
        if (fs.lstatSync(fullPath).isDirectory()) {
            res.push(...await findTaskFilesRecursively(fullPath, pattern))
        } else {
            if (isTaskFile(fullPath, true) && (!pattern || fullPath.includes(pattern))) {
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

export async function writeData(data: string | Buffer | Uint8Array, output: string | true, desc: string): Promise<string | true> {
    if (isString(output)) {
        // file
        await mkdirsOf(output)
        await fs.promises.writeFile(output, data)
        console.log(`${desc} written on ${output}`)
        return output
    } else {
        // stdout
        console.log(data)
        return true
    }
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