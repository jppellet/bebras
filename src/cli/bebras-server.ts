import { execSync } from "child_process"
import { Command } from "commander"
import * as fs from 'fs'
import beautify from 'js-beautify'
import * as yaml from "js-yaml"
import fetch, { fileFrom, FormData, Response } from 'node-fetch'
import * as path from "path"


import { warn } from "console"
import { languageNameAndShortCodeByLongCode } from "../codes"
import { convertImageFilename, cuttleImagePathForImage, emptyServerHTMLParts, makeServerHTMLFile, ParseResult, parseServerHTMLFile, parseTask, postprocessHtmlDecodingEntities, ServerHTMLParts, ServerHtmlTemplatePlaceholders, ServerHtmlTemplatePlaceholdersChecked, ServerHtmlTemplatePlaceholdersDirect } from "../convert_html"
import { findTasksFilesOrEnsureIsTaskFile, loadBebrasConfig, siblingWithExtension, urlExists, writeData } from "../fsutil"
import { patterns } from "../main"
import { answerTypesFor } from "../patterns"
import { BebrasConfig, BottomProgressBar, fatalError, isRecord, isString, md5, md5Matches, TaskMetadata } from "../util"
import _ = require("lodash")
import cheerio = require('cheerio')
import Token = require("markdown-it/lib/token")
import assert = require("assert")

type Subcommand = "new" | "upload" | "download" | "insert" | "checkimages"

const FixedOutputWidthPx = 700

export function makeCommand_server() {
    let cmd = new Command()
        .name("server")
        .alias("s")
        .description('Communicates with a Cuttle server')

    function addCommand(name: Subcommand, description: string, hasFields: boolean, cmd: Command, custom: (cmd: Command) => Command = cmd => cmd) {
        cmd = cmd
            .command(name)
            .alias(name.charAt(0))
            .description(description)
            .option('-r, --recursive', 'batch converts all tasks file in the source folder', false)
            .option('-F, --filter <pattern>', 'when in recursive mode, only consider files matching this pattern', false)
            .option('--debug', 'prints additional debug information')
        if (hasFields) {
            cmd = cmd.argument("<fields>", 'A comma-separated list of fields to process (e.g. "question,explanation")')
        }
        cmd = custom(cmd)
        cmd = cmd
            .argument("<source>", 'the source task file (or folder if -r is used)')
            .action((...args: [string, any]) => serverAction(name, hasFields, ...args))
    }

    const overwrite = (cmd: Command) => cmd
        .option('--overwrite', 'overwrite existing content in the target file(s)', false)
        .option('--overwrite-all', 'overwrite existing content, also if modified manually in the HTML file', false)

    addCommand("new", "Creates a new task on the Cuttle server", false, cmd, cmd => cmd
        .option('-f, --force', 'force creation of a server task even if one with the same ID exists', false)
        .option('-u, --upload', 'also run the full upload process', false)
        .option("-g, --grader <id>", "specify the grader ID to use for new tasks", "")
        .option("-F, --folder <id>", "specify the folder ID to use for new tasks", "")
    )

    addCommand("upload", "Uploads tasks to the Cuttle server", true, cmd, cmd => cmd
        .option('--skip-images', 'skip uploading of images', false)
    )

    addCommand("download", "Downloads tasks from the Cuttle server", false, cmd, overwrite)

    addCommand("insert", "Inserts sections into existing server HTML files", true, cmd, overwrite)

    addCommand("checkimages", "Reports missing images on the Cuttle server", false, cmd, cmd => cmd
        .option('--show-present', 'shows also images that are present on the server', false)
        .option('--unique', "don't mention images several times even if linked to multiple tasks", false)
    )

    return cmd
}

class ServerIDs {

    private readonly byServerID: Map<number, string> = new Map()
    private readonly byReadableName: Map<string, number> = new Map()
    public needsNewlineBeforeNextContent = false

    public constructor(
        public readonly name: string,
        public readonly dataFilename: string,
    ) { }

    public put(serverID: number, readableName: string) {
        let oldValue: string | number | undefined = this.byServerID.get(serverID)
        if (oldValue !== undefined) {
            warn(`Duplicate server ID mapping: ${serverID} -> ${readableName} (was ${oldValue})`)
        }
        oldValue = this.byReadableName.get(readableName)
        if (oldValue !== undefined) {
            warn(`Duplicate readable name mapping: ${readableName} -> ${serverID} (was ${oldValue})`)
        }
        this.byServerID.set(serverID, readableName)
        this.byReadableName.set(readableName, serverID)
    }

    public getName(serverID: number): string | undefined {
        return this.byServerID.get(serverID)
    }

    public getServerID(readableName: string): number | undefined {
        return this.byReadableName.get(readableName)
    }

    public get size(): number {
        return this.byServerID.size
    }

}

class ServerTaskContext {

    public readonly baseUrl: string
    public readonly tasks = new ServerIDs("tasks", "ServerTaskIDs.csv")
    public readonly graders = new ServerIDs("graders", "ServerGraderIDs.csv")
    public readonly folders = new ServerIDs("folders", "ServerFolderIDs.csv")

    public constructor(
        public readonly config: BebrasConfig,
        public readonly tasksFolder: string,
        public readonly apiKey: string,
        public readonly debug: boolean,
    ) {
        this.baseUrl = `https://${config.server.host}/`
    }

    public loadServerIDs() {
        const load = (serverIDs: ServerIDs) => {
            const serverIDsFile = path.join(this.tasksFolder, serverIDs.dataFilename)
            if (!fs.existsSync(serverIDsFile)) {
                fatalError(`Server IDs file not found to load ${serverIDs.name}: '${serverIDsFile}'`)
            }

            const rawContent = fs.readFileSync(serverIDsFile, 'utf-8')
            serverIDs.needsNewlineBeforeNextContent = !rawContent.endsWith("\n")
            const lines = rawContent.split(/\r?\n/)
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i]
                const trimmed = line.trim()
                if (trimmed === "" || trimmed.startsWith("#")) {
                    continue
                }
                const commaIndex = trimmed.indexOf(",")
                if (commaIndex === -1) {
                    warn(`Invalid line in file '${serverIDsFile}': ${line} `)
                    continue
                }
                const serverId = parseInt(trimmed.substring(0, commaIndex))
                if (isNaN(serverId)) {
                    if (i !== 0) {
                        // warn unless it's the first line, which may be a header
                        warn(`Invalid line in file '${serverIDsFile}': ${line} `)
                    }
                    continue
                }
                let localName = trimmed.substring(commaIndex + 1).trim()
                try {
                    const parsed = JSON.parse(localName)
                    if (isString(parsed)) {
                        localName = parsed
                    }
                } catch (error) {
                    // ignore, use raw string
                }

                serverIDs.put(serverId, localName)
            }

        }

        load(this.tasks)
        load(this.graders)
        load(this.folders)
    }

    public async saveNewServerTaskId(taskIdWithLang: string, serverTaskId: number): Promise<void> {
        this.tasks.put(serverTaskId, taskIdWithLang)
        const serverIDsFile = path.join(this.tasksFolder, this.tasks.dataFilename)
        const newDataLine = `${this.tasks.needsNewlineBeforeNextContent ? '\n' : ''}${serverTaskId},${taskIdWithLang}\n`
        try {
            await fs.promises.appendFile(serverIDsFile, newDataLine, { encoding: 'utf-8' })
            console.log(`New server task ID mapping written to ${this.tasks.dataFilename}: ${taskIdWithLang} -> ${serverTaskId}`)
        } catch (error) {
            fatalError(`Failed to write new server task ID to file '${serverIDsFile}': ${error}`)
        }
    }

}

class TaskSpec {

    public constructor(
        public readonly file: string,
        public readonly idWithLang: string,
        private readonly context: ServerTaskContext,
    ) { }

    private _parsed: ParseResult | undefined = undefined

    public async getParsed(): Promise<ParseResult> {
        if (this._parsed === undefined) {
            this._parsed = await parseTask(this.file, { makeImgSizeAbsoluteWithFullWidth: FixedOutputWidthPx })
            if (this.context.debug) {
                console.log(`Parsed task ${this.idWithLang} from file ${this.file}, metadata: ${JSON.stringify(this._parsed.metadata, null, 2)}`)
            }
        }
        return this._parsed
    }

    public getServerId(expectUndefined: boolean): number | undefined {
        const serverTaskId = this.context.tasks.getServerID(this.idWithLang)
        if (serverTaskId === undefined && !expectUndefined) {
            warn(`No server task id mapping found for task id with lang: ${this.idWithLang}, skipping file: ${this.file} `)
        }
        return serverTaskId
    }

}


export async function buildTaskSpecsFromFiles(taskFiles: string[], config: BebrasConfig, debug: boolean): Promise<[TaskSpec[], ServerTaskContext]> {
    const firstTaskFile = path.resolve(taskFiles[0]) // absolute path
    const tasksFolder = path.dirname(path.dirname(firstTaskFile))

    const apiKey = getCuttleApiKey(config)

    const context = new ServerTaskContext(config, tasksFolder, apiKey, debug)
    context.loadServerIDs()

    if (debug) {
        console.log(`apiKey = ${apiKey}`)
        console.log(`tasksFolder = ${tasksFolder}`)
        console.log(`tasks.size = ${context.tasks.size}`)
        console.log(`graders.size = ${context.graders.size}`)
        console.log(`folders.size = ${context.folders.size}`)
    }

    // prepare tasks to run
    const tasks: Array<TaskSpec> = []
    for (const taskFile of taskFiles) {
        const taskIdWithLang = path.basename(taskFile).split('.')[0]
        tasks.push(new TaskSpec(taskFile, taskIdWithLang, context))
    }

    return [tasks, context]
}




async function serverAction(subcommand: Subcommand, hasFields: boolean, ...varargs: any[]): Promise<void> {
    varargs.pop() // remove command object
    const options = varargs.pop()
    const debug = Boolean(options.debug)
    const isRecursive = Boolean(options.recursive)
    const filter: string | undefined = options.filter

    const source: string = varargs[hasFields ? 1 : 0]
    const fields: string[] | undefined = !hasFields ? undefined
        : (varargs[0] as string).split(",").map(s => s.trim())

    if (debug) {
        console.log(`command = ${subcommand} `)
        console.log(`source = ${source} `)
        if (fields !== undefined) {
            console.log(`fields = ${JSON.stringify(fields)} `)
        }
        console.log(`options = ${JSON.stringify(options, null, 2)} `)
    }

    const { taskFiles, commonFolder } = await findTasksFilesOrEnsureIsTaskFile(source, isRecursive, filter)

    if (taskFiles.length === 0) {
        fatalError("No task file found in " + source)
    }

    const config = await loadBebrasConfig(commonFolder)
    if (debug) {
        console.log(`config = ${JSON.stringify(config, null, 2)} `)
    }
    const [tasks, context] = await buildTaskSpecsFromFiles(taskFiles, config, debug)

    switch (subcommand) {
        case "new":
            await runCreateTaskOn(tasks, Boolean(options.force), Boolean(options.upload), String(options.grader ?? ""), String(options.folder ?? ""), context)
            return
        case "upload":
            await runUploadTaskOn(tasks, fields!, Boolean(options.skipImages), context)
            return
        case "download":
            await runDownloadTaskOn(tasks, Boolean(options.overwrite), Boolean(options.overwriteAll), context)
            return
        case "insert":
            await runInsertTaskOn(tasks, fields!, Boolean(options.overwrite), Boolean(options.overwriteAll), context)
            return
        case "checkimages":
            await runCheckImagesOn(tasks, Boolean(options.showPresent), Boolean(options.unique), context)
            return
    }
}

async function runCreateTaskOn(tasks: TaskSpec[], force: boolean, upload: boolean, defaultGraderSpec: string, defaultFolderSpec: string, context: ServerTaskContext): Promise<void> {
    if (context.debug) {
        console.log(`runCreateTaskOn(tasks.length=${tasks.length}, force=${force}, upload=${upload})`)
    }

    const createdTasks: TaskSpec[] = []

    await BottomProgressBar.showWhile(tasks.length, async pbar => {
        const resolveSpec = (spec: string, serverIDs: ServerIDs, defaultId: number): number => {
            if (spec.length > 0) {
                const id = serverIDs.getServerID(spec)
                if (id !== undefined) {
                    return id
                } else {
                    try {
                        return parseInt(spec)
                    } catch (error) {
                        // Ignore the error and return the default ID
                    }
                }
            }
            if (context.debug) {
                console.log(`Using default ${serverIDs.name} ID ${defaultId} (${serverIDs.getName(defaultId) ?? "<unknown>"})`)
            }
            return defaultId
        }
        const defaultGraderId = resolveSpec(defaultGraderSpec, context.graders, context.config.server.defaultGraderId)
        const defaultFolderId = resolveSpec(defaultFolderSpec, context.folders, context.config.server.defaultFolderId)

        for (const task of tasks) {
            const oldServerId = task.getServerId(true)
            if (oldServerId !== undefined) {
                const suffix = force ? ", will create a new one" : ", skipping (use --force to create a new one)"
                warn(`Task ${task.idWithLang} already exists on the server with ID ${oldServerId}${suffix}`)
                if (!force) {
                    continue
                }
            }
            pbar.update(`${task.idWithLang}`)

            const { md, options, tokens, metadata, langCode } = await task.getParsed()

            const parsedIdMatch = patterns.idWithLang.exec(task.idWithLang)
            let year
            if (parsedIdMatch === null) {
                warn(`Task ID ${task.idWithLang} does not match expected pattern for year extraction '${patterns.idPlain.source}', using default year 1900`)
                year = 1900
            } else {
                year = Number(parsedIdMatch.groups.year)
            }

            const payload = {
                "que_identifier": task.idWithLang,
                "que_name": metadata.title,
                "que_version": langCode,
                "que_year": year,
                "que_grd_id": defaultGraderId,
                "que_quf_id": defaultFolderId,
            }

            const data = await apiCall("POST", `question/new`, context, payload)

            const content = parseServerJson(data, task.idWithLang, undefined, context)
            if (content === undefined) {
                warn("Failed to convert server JSON to rich HTML for task id " + task.idWithLang)
                continue
            }

            await context.saveNewServerTaskId(task.idWithLang, content.serverTaskId)
            createdTasks.push(task)
        }
    })

    await runDownloadTaskOn(createdTasks, true, false, context)
    await runInsertTaskOn(createdTasks, context.config.vscode.autoExport, true, false, context)

    if (upload) {
        await runUploadTaskOn(createdTasks, context.config.vscode.autoUpload, false, context)
    }
}

export type UploadActionResult = {
    fields: string[]
    numSyncedTasks: number
    numUploadedImages: number
}

export async function runUploadTaskOn(tasks: TaskSpec[], fields: string[], skipImages: boolean, context: ServerTaskContext): Promise<UploadActionResult> {
    validateFields(fields)

    let numSyncedTasks = 0
    let numUploadedImages = 0

    await BottomProgressBar.showWhile(tasks.length, async pbar => {
        for (const task of tasks) {
            const serverTaskId = task.getServerId(false)
            if (serverTaskId === undefined) {
                continue
            }
            pbar.update(`${task.idWithLang} (server ID: ${serverTaskId})`)

            const targetFile = serverFileForTaskFile(task.file)
            if (!fs.existsSync(targetFile)) {
                fatalError(`Target server HTML file does not exist for upload: ${targetFile} `)
            }
            const content = parseServerHTMLFile(fs.readFileSync(targetFile, 'utf-8'))
            // console.log(`Parsed content for upload: ${JSON.stringify(content, null, 2)}`)


            const payload: Record<string, string> = {}
            for (const field of fields) {
                const { placeholderTitlePrefix, cuttleJsonFieldName } = AllFields[field]
                const sectionContent = String(content[`${placeholderTitlePrefix}Html`]).trim()
                payload[cuttleJsonFieldName] = sectionContent
            }

            const data = await apiCall("POST", `question/${serverTaskId}`, context, payload)
            // console.log(`Uploaded task ${taskIdWithLang} (server ID: ${serverTaskId}), server response: ${JSON.stringify(data, null, 2)}`)
            numSyncedTasks++

            if (skipImages) {
                continue
            }

            const newQuestionData = parseServerJson(data, task.idWithLang, serverTaskId, context)
            if (newQuestionData === undefined) {
                warn("Failed to convert server JSON to rich HTML for task id after upload: " + serverTaskId)
                warn("Skipping image upload for this task")
                continue
            }

            // console.log(`Uploading images for task ${task.idWithLang} (server ID: ${serverTaskId})`)

            // get all the images from the fields that we just uploaded
            const fieldImages = []
            for (const field of fields) {
                const fieldHtml = String(newQuestionData.htmlParts[`${AllFields[field].placeholderTitlePrefix}Html`])
                fieldImages.push(...extractImageUrlsFromHtml(fieldHtml))
            }

            if (context.debug) {
                console.log(`Found ${fieldImages.length} images in fields ${fields.join(", ")} for task ${task.idWithLang} (server ID: ${serverTaskId}):`)
                for (const [url, $imgElem] of fieldImages) {
                    console.log(`  ${url}`)
                }
            }

            const currentImages = await apiCall("GET", `question/${serverTaskId}/image`, context)
            const currentImagePaths: string[] = []
            if (Array.isArray(currentImages)) {
                for (const image of currentImages) {
                    if (isRecord(image) && "url" in image && isString(image.url)) {
                        currentImagePaths.push(image.url)
                    }
                }
            }

            if (context.debug) {
                console.log(`Currently on server for task ${task.idWithLang} (server ID: ${serverTaskId}), ${currentImagePaths.length} images:`)
                for (const url of currentImagePaths) {
                    console.log(`  ${url}`)
                }
            }

            const taskFolder = path.dirname(task.file)
            let numUploadedTaskImages = 0

            for (const [imgHtmlPath, __] of fieldImages) {
                if (currentImagePaths.includes(imgHtmlPath)) {
                    if (context.debug) {
                        console.log(`Image ${imgHtmlPath} is already on the server, skipping upload`)
                    }
                    continue
                }
                const imgHtmlName = path.basename(imgHtmlPath)

                const imgFile = findDescendantsMatching(taskFolder, (candidatePath, candidateName) => {
                    // first, quick match on name
                    const candidateHtmlName = convertImageFilename(candidateName)
                    if (candidateHtmlName !== imgHtmlName) {
                        return false
                    }
                    // then, check if the path matches the image URL
                    const candidateHtmlPath = cuttleImagePathForImage(candidatePath)
                    if (candidateHtmlPath !== imgHtmlPath) {
                        return false
                    }
                    return true
                })

                if (imgFile === undefined) {
                    console.warn(`No local image file found for ${imgHtmlPath} in task folder ${taskFolder}, skipping upload`)
                    continue
                }

                const resp = await apiCall("POST", `question/${serverTaskId}/image`, context, ['image', imgFile])

                const ok = isRecord(resp) && "url" in resp && resp.url === imgHtmlPath

                if (!ok) {
                    console.error(`Failed to upload image ${imgHtmlPath} from local file ${imgFile} for task ${task.idWithLang}: server response: ${JSON.stringify(resp, null, 2)}`)
                    continue
                }

                numUploadedTaskImages++

            }

            if (numUploadedTaskImages > 0) {
                console.log(`Uploaded ${numUploadedTaskImages} images for task ${task.idWithLang} (${fieldImages.length - numUploadedTaskImages} already on server) `)
            } else if (context.debug) {
                console.log(`No new images to upload for task ${task.idWithLang}`)
            }

            numUploadedImages += numUploadedTaskImages

        }
    })

    return { fields, numSyncedTasks, numUploadedImages }
}

function findDescendantsMatching(folder: string, isMatch: (path: string, name: string) => boolean): string | undefined {
    return visit(folder)

    function visit(dir: string): string | undefined {
        const entries = fs.readdirSync(dir, { withFileTypes: true })

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name)

            if (entry.isDirectory()) {
                const result = visit(fullPath)
                if (result !== undefined) {
                    return result
                }
            } else if (entry.isFile()) {
                if (isMatch(fullPath, entry.name)) {
                    return fullPath
                }
            }
        }

        return undefined
    }
}

async function apiCall(method: "GET" | "POST", path: string, context: ServerTaskContext, payload?: Record<string, unknown> | [fieldName: string, file: string]): Promise<unknown> {
    const url = `${context.baseUrl}admin/api/dbmanage/${path}`

    if (context.debug) {
        console.log(`Making API call: ${method} ${url}`)
        if (payload) {
            console.log(`Payload: ${JSON.stringify(payload, null, 2)}`)
        }
    }

    let response: Response | undefined = undefined
    try {
        let body = undefined
        let additionalHeaders: Record<string, string> = {}
        if (Array.isArray(payload)) {
            // file name
            const [fieldName, file] = payload
            const formData = new FormData()
            formData.append(fieldName, await fileFrom(file))
            body = formData

        } else if (isRecord(payload)) {
            // If payload is a record, we'll treat it as JSON
            body = JSON.stringify(payload)
            additionalHeaders["Content-Type"] = "application/json"
        }

        response = await fetch(url, {
            method,
            headers: {
                "cuttle-api-key": context.apiKey,
                ...additionalHeaders,
            },
            body,
        })
    } catch (error) {
        fatalError(`Failed to connect to server at ${url}: ${error}`)
    }

    const responseBody = await response.text()

    if (context.debug) {
        console.log(`Response status: ${response.status} ${response.statusText}`)
        // body
        console.log(`Response body: ${responseBody}`)
    }

    if (!response.ok) {
        // any json response in the body?
        let details: string = responseBody
        try {
            const json = JSON.parse(details)
            if (isString(json)) {
                details = json
            } else if (isRecord(json) && "message" in json) {
                details = String(json.message)
            }
        } catch {
            // ignore, use raw text
        }
        details = details.trim()
        if (details.length > 0) {
            details = "; details: " + details
        }
        fatalError(`Request failed: ${response.status} ${response.statusText}${details}`)
    }

    const responseData = JSON.parse(responseBody)

    if (responseData === undefined || responseData === null) {
        fatalError(`No data received from server for call to '${path}'`)
    }

    if (context.debug) {
        console.log(`Call to '${path}' got response: ${JSON.stringify(responseData, null, 2)}`)
    }

    return responseData
}

async function runDownloadTaskOn(tasks: TaskSpec[], overwrite: boolean, overwriteAll: boolean, context: ServerTaskContext): Promise<void> {
    if (context.debug) {
        console.log(`runDownloadTaskOn(tasks.length=${tasks.length}, overwrite=${overwrite}, overwriteAll=${overwriteAll})`)
    }

    let numModified = 0

    await BottomProgressBar.showWhile(tasks.length, async pbar => {
        for (const task of tasks) {
            const serverTaskId = task.getServerId(false)
            if (serverTaskId === undefined) {
                continue
            }
            pbar.update(`${task.idWithLang} (server ID: ${serverTaskId})`)

            const targetFile = serverFileForTaskFile(task.file)

            const data = await apiCall("GET", `question/${serverTaskId}`, context)

            const parsed = parseServerJson(data, task.idWithLang, serverTaskId, context)
            if (parsed === undefined) {
                fatalError("Failed to convert server JSON to rich HTML for task id " + serverTaskId)
            }

            const taskMetadata = (await task.getParsed()).metadata
            const written = await writeOrMerge(targetFile, taskMetadata, parsed.htmlParts, overwrite, overwriteAll, context)

            if (written) {
                numModified++
            }

        }
    })

    if (numModified === 0) {
        console.log("No local task file modified.")
    } else {
        console.log(`Modified local file for ${numModified} out of ${tasks.length} tasks.`)
    }
}

/**
 * Tries to write newContent into targetFile, merging with existing content if necessary.
 * 
 * If existing non-trivial content is found in targetFile, and overwrite is false, the function
 * will do nothing return false. This is also the case if locally modified content is found
 * (i.e., content whose hash does not match the stored generated hash) and overwriteAll is false.
 */
async function writeOrMerge(targetFile: string, taskMetadata: TaskMetadata, newContent: Partial<ServerHTMLParts>, overwrite: boolean, overwriteAll: boolean, context: ServerTaskContext): Promise<boolean> {

    if (overwriteAll) {
        overwrite = true
    }

    // called to write content and verify by parsing back, useful during development
    async function writeAndCheck(content: ServerHTMLParts): Promise<void> {
        const serverHtml = makeServerHTMLFile(context.config, content)
        // verify by parsing back
        const parsedContent = parseServerHTMLFile(serverHtml)
        if (!_.isEqual(parsedContent, content)) {
            warn(`Warning: parsed content does not match generated content in ${targetFile}`)
            warn("Fields to write:", content)
            warn("Parsed fields from saved HTML:", parsedContent)
        }

        await writeData(serverHtml, targetFile, `Server HTML`)
    }

    const fileExists = fs.existsSync(targetFile)

    // do we just write a new file?
    if (!fileExists) {
        await writeAndCheck({ ...emptyServerHTMLParts(taskMetadata), ...newContent })
        return true
    }

    // we merge with existing file
    const existingContent = parseServerHTMLFile(fs.readFileSync(targetFile, 'utf-8'))

    // diagnotics from going through fields
    let hasNewContent = false
    const locallyModifiedFields: ServerHtmlTemplatePlaceholders[] = []
    const existingNonTrivialFields: [ServerHtmlTemplatePlaceholders, string | undefined][] = []

    // called for each field to ensure if it can be inserted
    const checkFieldCanBeInserted = (key: ServerHtmlTemplatePlaceholders, existingHash?: string, existingSource?: string): void => {
        if (!(key in newContent)) {
            return // nothing to insert
        }

        const existingContentSection = String(existingContent[key]).trim()
        const existingContentIsTrivial = existingContentSection.length === 0
        const existingContentIsLocallyModified = !existingContentIsTrivial && existingHash && !md5Matches(existingContentSection, existingHash)
        const newContentSection = String(newContent[key]).trim()
        const contentIsDifferent = existingContentSection !== newContentSection

        if (contentIsDifferent) {
            if (existingContentIsLocallyModified && !overwriteAll) {
                // we require --overwrite-all to overwrite locally modified content
                locallyModifiedFields.push(key)
            } else if (!existingContentIsTrivial && !overwrite) {
                // we require --overwrite to overwrite existing non-trivial content
                existingNonTrivialFields.push([key, existingSource])
            } else {
                hasNewContent = true
            }
        }
    }

    // loop though all simple fields and then all checksummed fields
    for (const key of ServerHtmlTemplatePlaceholdersDirect) {
        checkFieldCanBeInserted(key)
    }
    for (const key of ServerHtmlTemplatePlaceholdersChecked) {
        const existingHash = String(existingContent[`${key}Hash`]).trim()
        const existingSource = String(existingContent[`${key}Source`]).trim()
        checkFieldCanBeInserted(`${key}Html`, existingHash, existingSource)
    }

    // is there anything to report?
    let cancel = false
    if (locallyModifiedFields.length > 0) {
        for (const field of locallyModifiedFields) {
            warn(`${path.basename(targetFile)}: content for '${field}' has been modified locally, use --overwrite-all to overwrite (and lose the local changes!)`)
        }
        cancel = true
    }
    if (existingNonTrivialFields.length > 0) {
        const sources = existingNonTrivialFields.map(([field, source]) => `'${field}'${source ? ` from ${source}` : ""}`).join(", ")
        warn(`${path.basename(targetFile)}: content already exists (${sources}), use --overwrite to overwrite`)
        cancel = true
    }

    // should we cancel? do we have new content?
    if (cancel || !hasNewContent) {
        return false
    }

    // alright, we can write the new content
    await writeAndCheck({ ...existingContent, ...newContent })
    return true
}


const AllFields = {
    "question": {
        sectionTitle: "Body",
        placeholderTitlePrefix: "question",
        cuttleJsonFieldName: "que_content",
    },
    "answer": {
        sectionTitle: "Answer Explanation",
        placeholderTitlePrefix: "answer",
        cuttleJsonFieldName: "que_explanation",
    },
    "itsinformatics": {
        sectionTitle: "This is Informatics",
        placeholderTitlePrefix: "itsinformatics",
        cuttleJsonFieldName: "que_background_info",
    },
} as const satisfies Record<string, {
    sectionTitle: string,
    placeholderTitlePrefix: string,
    cuttleJsonFieldName: string
}>

function validateFields(fields: string[]): asserts fields is (keyof typeof AllFields)[] {
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i].toLowerCase()
        let matched = false
        for (const validField of Object.keys(AllFields)) {
            if (validField.startsWith(field)) {
                fields[i] = validField
                matched = true
                break
            }
        }
        if (!matched) {
            fatalError(`Invalid field: ${fields[i]}. Valid fields are: ${Object.keys(AllFields).join(", ")}; prefix matching is allowed.`)
        }
    }
}

export async function runInsertTaskOn(tasks: TaskSpec[], fields: string[], overwrite: boolean, overwriteAll: boolean, context: ServerTaskContext): Promise<string[]> {
    if (context.debug) {
        console.log(`runInsertTaskOn(tasks.length=${tasks.length}, fields=${fields.join(", ")}, overwrite=${overwrite}, overwriteAll=${overwriteAll})`)
    }

    validateFields(fields)

    const modifiedFiles: string[] = []
    await BottomProgressBar.showWhile(tasks.length, async pbar => {
        for (const task of tasks) {
            pbar.update(task.idWithLang)

            const targetFile = serverFileForTaskFile(task.file)

            const { md, options, tokens, metadata, langCode } = await task.getParsed()

            type AnswerType = ReturnType<typeof answerTypesFor>[number]
            const AnswerTypesWhereAnswerOptionsAreShown: Array<AnswerType> =
                ["multiple choice", "multiple choice with images", "multiple select", "multiple select with images"]

            function sectionHtmlFor(sectionTitle: string, ...fallbackTitles: string[]): string {
                let sectionTokens = extractTokensForSection(sectionTitle, tokens)
                if (sectionTokens.length === 0) {
                    for (const fallbackTitle of fallbackTitles) {
                        sectionTokens = extractTokensForSection(fallbackTitle, tokens)
                        if (sectionTokens.length > 0) {
                            break
                        }
                    }
                }
                if (sectionTokens.length === 0) {
                    return ""
                }
                return md.renderer.render(sectionTokens, options as any, {})
            }

            const CuttleConversionStrings = {
                PossibleAnswers: {
                    eng: "Possible Answers",
                    deu: "Antwortalternativen",
                    fra: "Réponses possibles",
                    ita: "Possibili risposte",
                },
                KeywordsAndWebsites: {
                    eng: "Keywords",
                    deu: "Stichwörter",
                    fra: "Mots clés",
                    ita: "Parole chiave",
                },
            }

            type TranslationString = keyof typeof CuttleConversionStrings

            function getString(key: TranslationString): string {
                const s = CuttleConversionStrings[key]
                if (langCode in s) {
                    return s[langCode as keyof typeof s]
                }
                return s.eng
            }

            const newContent: Partial<ServerHTMLParts> = {}
            for (const field of fields) {
                const { sectionTitle, placeholderTitlePrefix } = AllFields[field]

                // base field html
                let renderedHtml = sectionHtmlFor(sectionTitle)

                // customized postprocessing for some fields
                if (field === "question") {
                    const question = sectionHtmlFor("Question/Challenge", "Question/Challenge - for the online challenge")
                    renderedHtml += `<div class="question-prompt">${question}</div>`
                    const isInteractive = metadata.answer_type.includes("interactive")
                    if (isInteractive) {
                        renderedHtml += `<center><div id="task-container">&nbsp;</div></center>`

                        const interactivityInstr = sectionHtmlFor("Interactivity Instructions", "Interactivity Instructions - for the online challenge", "Interactivity instruction - for the online challenge")
                        renderedHtml += `<div class="interactivity-instructions">${interactivityInstr}</div>`
                    }

                } else if (field === "answer" && AnswerTypesWhereAnswerOptionsAreShown.includes(metadata.answer_type as AnswerType)) {
                    const answerOptionsHtml = sectionHtmlFor("Answer Options/Interactivity Description")
                    // console.log("--- " + metadata.id + " " + answerOptionsHtml.substring(0, 80).replace(/\s+/g, " ") + " ...")
                    const answersTitle = `<div class="subtitle">${getString("PossibleAnswers")}</div>`
                    renderedHtml = '<div class="answer-options">' + answersTitle + answerOptionsHtml + "</div>" + renderedHtml

                } else if (field === "itsinformatics") {
                    const keywordsHtml = sectionHtmlFor("Informatics Keywords and Websites")
                    const keywordsTitle = `<div class="subtitle">${getString("KeywordsAndWebsites")}</div>`
                    renderedHtml = renderedHtml + '<div class="keywords">' + keywordsTitle + keywordsHtml + "</div>"
                }

                // final prettification and storage
                const htmlContent = prettifySectionHtml(renderedHtml, task.file, true)
                newContent[`${placeholderTitlePrefix}Html`] = htmlContent
                newContent[`${placeholderTitlePrefix}Hash`] = md5(htmlContent)
                newContent[`${placeholderTitlePrefix}Source`] = "markdown"
            }
            const modified = await writeOrMerge(targetFile, metadata, newContent, overwrite, overwriteAll, context)
            if (modified) {
                modifiedFiles.push(targetFile)
            }
        }
    })

    if (modifiedFiles.length === 0) {
        console.log("No local task file modified.")
    } else {
        console.log(`Modified local file for ${modifiedFiles.length} out of ${tasks.length} tasks.`)
    }
    return modifiedFiles
}

type CheerioElementAPI = ReturnType<ReturnType<typeof cheerio.load>>

function extractImageUrlsFromHtml(html: string): Array<[string, CheerioElementAPI]> {
    const $ = cheerio.load(html)
    const imgElements = $('img')
    const urls: Array<[string, CheerioElementAPI]> = []
    for (const imgElem of imgElements.toArray()) {
        const $imgElem = $(imgElem)
        const src = $imgElem.attr('src')
        if (src) {
            urls.push([src, $imgElem])
        }
    }
    return urls
}


let _urlExistsCache: Record<string, boolean> = {}
const urlExistsCached = async (url: string): Promise<boolean> => {
    if (url in _urlExistsCache) {
        return _urlExistsCache[url]
    }
    const exists = await urlExists(url, 3000)
    _urlExistsCache[url] = exists
    return exists
}
const urlExistsClearCache = () => {
    _urlExistsCache = {}
}

async function runCheckImagesOn(tasks: TaskSpec[], showPresent: boolean, unique: boolean, context: ServerTaskContext): Promise<void> {
    if (context.debug) {
        console.log(`runCheckImagesOn(tasks.length=${tasks.length}, showPresent=${showPresent}, unique=${unique})`)
    }

    let numMissing = 0
    let numPresent = 0
    urlExistsClearCache()

    await BottomProgressBar.showWhile(tasks.length, async pbar => {
        for (const task of tasks) {
            const serverTaskId = task.getServerId(false)
            if (serverTaskId === undefined) {
                continue
            }
            pbar.update(task.idWithLang)

            const targetFile = serverFileForTaskFile(task.file)
            if (!fs.existsSync(targetFile)) {
                fatalError(`Target server HTML file does not exist for graphics check: ${targetFile} `)
            }

            const content = fs.readFileSync(targetFile, 'utf-8')

            const missing: [serverUrl: string, localPath: string | undefined, sectionId: string | undefined][] = []
            const present: typeof missing = []

            for (const [src, $imgElem] of extractImageUrlsFromHtml(content)) {
                const fullUrl = `${context.baseUrl}${src}`
                if (!unique || !(fullUrl in _urlExistsCache)) {
                    const localSrc = $imgElem.attr('data-local-src')
                    const urlExists = await urlExistsCached(fullUrl)
                    const targetList = urlExists ? present : missing
                    const parent = $imgElem.closest('div.task-section')
                    const parentId = parent.attr('id')
                    targetList.push([src, localSrc, parentId])
                }
            }

            // anything to show?
            const doShowMissing = missing.length > 0
            const doShowPresent = showPresent && present.length > 0
            if (doShowMissing || doShowPresent) {
                const prefix = showPresent ? "For" : "Missing images for"
                console.log(`${prefix} task ${task.idWithLang} (server ID: ${serverTaskId}):`)
                if (doShowPresent) {
                    console.log(`  Present images:`)
                    present.forEach(logImage)
                }
                if (doShowMissing) {
                    if (showPresent) {
                        console.log(`  Missing images:`)
                    }
                    missing.forEach(logImage)
                }

                function logImage([img, localSrc, parentId]: [string, string | undefined, string | undefined]) {
                    console.log(`    ${localSrc ? localSrc + "  -->  " : ""}${img}` + (parentId ? ` (in ${parentId})` : ''))
                }
            }

            numMissing += missing.length
            numPresent += present.length
        }
    })

    urlExistsClearCache()

    const dupesExpl = unique ? "each image mentioned only in the first task where it appears" : "images may be mentioned multiple times if they appear in multiple tasks"
    console.log(`Total missing: ${numMissing}; total present: ${numPresent} (checked ${numMissing + numPresent} images in ${tasks.length} tasks; ${dupesExpl})`)
}

function extractTokensForSection(sectionName: string, tokens: Token[]): Token[] {
    const sectionTokens: Token[] = []
    let inSection = false
    for (const t of tokens) {
        if (t.type === "secbody_open" && t.info === sectionName) {
            inSection = true
            continue
        }
        if (inSection) {
            if (t.type === "secbody_close") {
                break
            }
            sectionTokens.push(t)
        }
    }
    return sectionTokens
}

function serverFileForTaskFile(taskFile: string): string {
    return siblingWithExtension(path.join(path.dirname(taskFile), "server", path.basename(taskFile)), `.cuttle.html`)
}

function unknown(id: number): string {
    return `<unknown:${id}>`
}

function parseUnkownId(unknownIdString: string): number | undefined {
    const match = unknownIdString.match(/^<unknown:(?:\d+)>$/)
    if (match) {
        return Number(match[1])
    }
    return undefined
}

function parseServerJson(json: unknown, taskId: string, serverTaskIdExpected: number | undefined, context: ServerTaskContext): { htmlParts: ServerHTMLParts, serverTaskId: number } | undefined {
    if (Array.isArray(json) && json.length === 1) {
        json = json[0]
    }

    if (typeof json !== "object" || json === null) {
        return undefined
    }

    type FieldDef<T> = T extends string
        ? [serverName: string, localName: string, defaultValue: string]
        : T extends boolean // not sure why we need this special case, but OK
        ? [serverName: string, localName: string, defaultValue: boolean, parser: (s: string) => boolean]
        : [serverName: string, localName: string, defaultValue: T, parser: (s: string) => T]

    const toBool = (s: string) => s.toLowerCase() === "true"

    const fieldsForYaml = [
        ["que_identifier", "id", "0000-AA-00-eng"],
        ["que_version", "lang", "n/a"],
        ["que_year", "year", 1900, Number],
        ["que_id", "serverId", 0, Number],
        ["que_name", "title", "n/a"],
        ["que_grd_id", "grader", 0, Number],
        ["que_quf_id", "folder", 0, Number],
        ["que_allow_school_usage", "allowSchoolUsage", false, toBool],
    ] as const satisfies FieldDef<string | number | boolean>[]

    type YamlField = typeof fieldsForYaml[number][1]

    const yamlData: Record<YamlField, string | number | boolean> = {} as any
    for (const [serverField, localField, defaultValue, parser] of fieldsForYaml) {
        let value: string | number | boolean | undefined = undefined
        if (!(serverField in json)) {
            warn(`Field ${serverField} not found in server JSON`)
        } else {
            const jsonValue = json[serverField as keyof typeof json]
            if (jsonValue === null || jsonValue === undefined) {
                warn(`Field ${serverField} is ${jsonValue} in server JSON`)
            } else {
                if (typeof jsonValue === "string" || typeof jsonValue === "number" || typeof jsonValue === "boolean") {
                    value = String(jsonValue)
                } else {
                    warn(`Field ${serverField} has unexpected type in server JSON (value: ${JSON.stringify(jsonValue)})`)
                }
                if (parser && value !== undefined) {
                    value = parser(value)
                }
            }
        }
        yamlData[localField] = value ?? defaultValue
    }

    // Data consistency checks
    const taskIdFromYaml = String(yamlData.id)
    if (taskIdFromYaml !== taskId) {
        warn(`Warning: taskId mismatch: expected ${taskId}, got ${taskIdFromYaml}`)
    }
    const serverTaskIdActual = Number(yamlData.serverId)
    if (serverTaskIdExpected !== undefined && serverTaskIdActual !== serverTaskIdExpected) {
        warn(`Warning: serverTaskId mismatch: expected ${serverTaskIdExpected}, got ${serverTaskIdActual}`)
    }
    const graderId = Number(yamlData.grader)
    const graderName = context.graders.getName(graderId)
    if (graderName === undefined) {
        warn(`Warning: grader name not found for grader ID ${yamlData.grader}`)
        yamlData.grader = unknown(graderId)
    } else {
        yamlData.grader = graderName
    }
    const folderId = Number(yamlData.folder)
    const folderName = context.folders.getName(folderId)
    if (folderName === undefined) {
        warn(`Warning: folder name not found for folder ID ${yamlData.folder}`)
        yamlData.folder = unknown(folderId)
    } else {
        yamlData.folder = folderName
    }
    if (languageNameAndShortCodeByLongCode[String(yamlData.lang)] === undefined) {
        warn(`Warning: unknown language code: ${yamlData.lang}`)
    }
    const match = taskIdFromYaml.match(/^.*-(?<lang>[a-z]{3})$/)
    if (match) {
        const langInId = match.groups!.lang
        if (languageNameAndShortCodeByLongCode[langInId] === undefined) {
            warn(`Warning: unknown language code in id: ${langInId}`)
        }
        if (langInId !== String(yamlData.lang)) {
            warn(`Warning: language code mismatch between id and lang field: ${langInId} vs ${yamlData.lang}`)
        }
        yamlData.id = taskIdFromYaml.substring(0, taskIdFromYaml.length - 4)
    } else {
        warn(`Warning: cannot extract language code from id: ${yamlData.id}`)
    }

    function getHtmlField(fieldName: string): [html: string, hash: string] {
        const html = prettifySectionHtml((json as any)[fieldName], false, false)
        const hash = html.length === 0 ? "-" : md5(html)
        return [html, hash]
    }

    const [questionHtml, questionHash] = getHtmlField('que_content')
    const [answerHtml, answerHash] = getHtmlField('que_explanation')
    const [itsinformaticsHtml, itsinformaticsHash] = getHtmlField('que_background_info')
    const source = "server"

    const content: ServerHTMLParts = {
        htmlTitle: `${yamlData.id} — ${yamlData.title}-${yamlData.lang}`,
        taskTitle: yamlData.title,
        taskId: yamlData.id,
        yamlMetadata: yaml.dump(yamlData, { indent: 4 }).trim(),
        graderSpec: (json as any)['que_answers']?.trim() ?? "",
        questionHtml, questionHash, questionSource: source,
        answerHtml, answerHash, answerSource: source,
        itsinformaticsHtml, itsinformaticsHash, itsinformaticsSource: source,
    }

    return { htmlParts: content, serverTaskId: serverTaskIdActual }
}

function prettifySectionHtml(rawHtml: string | undefined,
    transformImagesFromTaskFile: string | false,
    postprocessFromMarkdown: boolean,
): string {
    if (!rawHtml?.trim()) {
        return ""
    }
    const withDecodedEntities = postprocessHtmlDecodingEntities(rawHtml, transformImagesFromTaskFile, postprocessFromMarkdown)
    const prettified = beautify.html(withDecodedEntities, {
        indent_size: 4,
        indent_level: 2,
        indent_char: " ",
        max_preserve_newlines: 5,
        preserve_newlines: true,
        indent_scripts: "keep",
        end_with_newline: false,
        wrap_line_length: 0,
        indent_inner_html: false,
        indent_empty_lines: false,
    }).trim()
    return prettified
}

function getCuttleApiKey(config: BebrasConfig): string {
    const apiKeyFromConfig = config.server.apiKey
    if (apiKeyFromConfig && apiKeyFromConfig.length > 0) {
        return apiKeyFromConfig
    }

    const hostname = config.server.host
    // Get the CUTTLEAPIKEY from macOS Keychain
    try {
        const key = execSync(
            `security find-generic-password -a bebras -s "cuttle_question_api:${hostname}" -w`,
            { encoding: "utf8" }
        ).trim()
        if (key.length === 0) {
            fatalError("Empty API key")
        }
        return key
    } catch (err) {
        fatalError("Cuttle API key not found in macOS Keychain; add it using:\n" +
            `  security add-generic-password -a bebras -s "cuttle_question_api:${hostname}" -w <API_KEY>\n` +
            "where <API_KEY> is your Cuttle question API key.")
    }
}
