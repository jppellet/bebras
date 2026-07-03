import { execSync } from "child_process"
import { Command } from "commander"
import * as fs from 'fs'
import beautify from 'js-beautify'
import * as yaml from "js-yaml"
import fetch, { Response } from 'node-fetch'
import * as path from "path"


import { warn } from "console"
import { languageNameAndShortCodeByLongCode } from "../codes"
import { emptyServerHTMLParts, makeServerHTMLFile, parseServerHTMLFile, parseTask, postprocessHtmlDecodingEntities, ServerHTMLParts, ServerHtmlTemplatePlaceholders, ServerHtmlTemplatePlaceholdersChecked, ServerHtmlTemplatePlaceholdersDirect } from "../convert_html"
import { findTasksFilesOrEnsureIsTaskFile, siblingWithExtension, urlExists, writeData } from "../fsutil"
import { answerTypesFor } from "../patterns"
import { BottomProgressBar, fatalError, md5, md5Matches } from "../util"
import _ = require("lodash")
import cheerio = require('cheerio')
import Token = require("markdown-it/lib/token")
import assert = require("assert")

type Subcommand = "upload" | "download" | "insert" | "checkimages"

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

    addCommand("upload", "Uploads tasks to the Cuttle server", true, cmd)

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

    public constructor(
        hostname: string,
        public readonly apiKey: string,
        public readonly debug: boolean,
    ) {
        this.baseUrl = `https://${hostname}/`
    }

    public loadServerIDs(tasksFolder: string) {
        load(this.tasks)
        load(this.graders)

        function load(serverIDs: ServerIDs) {
            const serverIDsFile = path.join(tasksFolder, serverIDs.dataFilename)
            if (!fs.existsSync(serverIDsFile)) {
                fatalError(`Server IDs file not found to load ${serverIDs.name}: '${serverIDsFile}'`)
            }

            const lines = fs.readFileSync(serverIDsFile, 'utf-8').split(/\r?\n/)
            for (const line of lines) {
                const trimmed = line.trim()
                if (trimmed === "" || trimmed.startsWith("#")) {
                    continue
                }
                const parts = trimmed.split(",").map(s => s.trim())
                if (parts.length !== 2) {
                    warn(`Invalid line in file '${serverIDsFile}': ${line} `)
                    continue
                }
                const localName = parts[1]
                const serverId = Number(parts[0])
                if (isNaN(serverId)) {
                    warn(`Invalid line in file '${serverIDsFile}': ${line} `)
                    continue
                }
                serverIDs.put(serverId, localName)
            }

        }
    }
}

type TaskSpec = { taskFile: string, taskIdWithLang: string, serverTaskId: number }

export function buildTaskSpecsFromFiles(taskFiles: string[], debug: boolean): [TaskSpec[], ServerTaskContext] {
    const tasksFolder = path.dirname(path.dirname(taskFiles[0]))

    const hostname = "wettbewerb.informatik-biber.ch"
    const apiKey = getCuttleApiKey(hostname)

    const context = new ServerTaskContext(hostname, apiKey, debug)
    context.loadServerIDs(tasksFolder)

    if (debug) {
        console.log(`apiKey = ${apiKey}`)
        console.log(`tasksFolder = ${tasksFolder}`)
        console.log(`tasks.size = ${context.tasks.size}`)
        console.log(`graders.size = ${context.graders.size}`)
    }

    // prepare tasks to run
    const tasks: Array<TaskSpec> = []

    for (const taskFile of taskFiles) {
        const taskIdWithLang = taskFile.split('/').pop()!.split('.')[0]
        const serverTaskId = context.tasks.getServerID(taskIdWithLang)
        if (serverTaskId === undefined) {
            warn(`No server task id mapping found for task id with lang: ${taskIdWithLang}, skipping file: ${taskFile} `)
            continue
        }
        tasks.push({ taskFile, taskIdWithLang, serverTaskId })
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

    const taskFiles = await findTasksFilesOrEnsureIsTaskFile(source, isRecursive, filter)
    if (taskFiles.length === 0) {
        fatalError("No task file found in " + source)
    }

    const [tasks, context] = buildTaskSpecsFromFiles(taskFiles, debug)

    switch (subcommand) {
        case "upload":
            await runUploadTaskOn(tasks, fields!, context)
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

async function runUploadTaskOn(tasks: TaskSpec[], fields: string[], context: ServerTaskContext): Promise<void> {
    validateFields(fields)

    await BottomProgressBar.showWhile(tasks.length, async pbar => {
        for (const { taskFile, taskIdWithLang, serverTaskId } of tasks) {
            pbar.update(`${taskIdWithLang} (server ID: ${serverTaskId})`)

            const targetFile = serverFileForTaskFile(taskFile)
            if (!fs.existsSync(targetFile)) {
                fatalError(`Target server HTML file does not exist for upload: ${targetFile} `)
            }
            const content = parseServerHTMLFile(fs.readFileSync(targetFile, 'utf-8'))
            const url = `${context.baseUrl}/admin/api/dbmanage/question/${serverTaskId}`


            const payload: Record<string, string> = {}
            for (const field of fields) {
                const { placeholderTitlePrefix, cuttleJsonFieldName } = AllFields[field]
                const sectionContent = String(content[`${placeholderTitlePrefix}Html`]).trim()
                payload[cuttleJsonFieldName] = sectionContent
            }

            let response: Response | undefined = undefined

            try {
                response = await fetch(url, {
                    method: "POST",
                    headers: {
                        "cuttle-api-key": context.apiKey,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(payload),
                })
            } catch (error) {
                fatalError(`Failed to connect to server at ${url}: ${error}`)
            }

            if (!response.ok) {
                fatalError(`Request failed: ${response.status} ${response.statusText}`)
            }

            await response.json()
        }
    })

}

async function runDownloadTaskOn(tasks: TaskSpec[], overwrite: boolean, overwriteAll: boolean, context: ServerTaskContext): Promise<void> {
    let numModified = 0

    await BottomProgressBar.showWhile(tasks.length, async pbar => {
        for (const { taskFile, taskIdWithLang, serverTaskId } of tasks) {
            pbar.update(`${taskIdWithLang} (server ID: ${serverTaskId})`)

            const targetFile = serverFileForTaskFile(taskFile)
            const url = `${context.baseUrl}/admin/api/dbmanage/question/${serverTaskId}`

            let response: Response | undefined = undefined
            try {
                response = await fetch(url, {
                    method: "GET",
                    headers: {
                        "cuttle-api-key": context.apiKey,
                    },
                })
            } catch (error) {
                fatalError(`Failed to connect to server at ${url}: ${error}`)
            }

            if (!response.ok) {
                fatalError(`Request failed: ${response.status} ${response.statusText}`)
            }

            const data = await response.json()
            if (!data) {
                fatalError("No data received from server for task id " + serverTaskId)
            }
            if (context.debug) {
                console.log("Received data:", JSON.stringify(data, null, 2))
            }
            const content = parseServerJson(data, taskIdWithLang, serverTaskId, context)
            if (content === undefined) {
                fatalError("Failed to convert server JSON to rich HTML for task id " + serverTaskId)
            }

            const written = await writeOrMerge(targetFile, content, overwrite, overwriteAll, context)

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
 * (i.e., content * whose hash does not match the stored generated hash) and overwriteAll is false.
 */
async function writeOrMerge(targetFile: string, newContent: Partial<ServerHTMLParts>, overwrite: boolean, overwriteAll: boolean, context: ServerTaskContext): Promise<boolean> {

    if (overwriteAll) {
        overwrite = true
    }

    // called to write content and verify by parsing back, useful during development
    async function writeAndCheck(content: ServerHTMLParts): Promise<void> {
        const serverHtml = makeServerHTMLFile(content)
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
        await writeAndCheck({ ...emptyServerHTMLParts(context.baseUrl), ...newContent })
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
    "answer": { sectionTitle: "Answer Explanation", placeholderTitlePrefix: "answer", cuttleJsonFieldName: "que_explanation" },
    "itsinformatics": { sectionTitle: "This is Informatics", placeholderTitlePrefix: "itsinformatics", cuttleJsonFieldName: "que_background_info" },
} as const satisfies Record<string, { sectionTitle: string, placeholderTitlePrefix: string, cuttleJsonFieldName: string }>

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
    validateFields(fields)

    const modifiedFiles: string[] = []
    await BottomProgressBar.showWhile(tasks.length, async pbar => {
        for (const { taskFile, taskIdWithLang } of tasks) {
            pbar.update(taskIdWithLang)

            const targetFile = serverFileForTaskFile(taskFile)
            if (!fs.existsSync(targetFile)) {
                fatalError(`Target server HTML file does not exist for insertion: ${targetFile} `)
            }

            const { md, options, tokens, metadata, langCode } = await parseTask(taskFile, { makeImgSizeAbsoluteWithFullWidth: FixedOutputWidthPx })

            type AnswerType = ReturnType<typeof answerTypesFor>[number]
            const AnswerTypesWhereAnswerOptionsAreShown: Array<AnswerType> =
                ["multiple choice", "multiple choice with images", "multiple select", "multiple select with images"]

            function sectionHtmlFor(sectionTitle: string): string {
                const sectionTokens = extractTokensForSection(sectionTitle, tokens)
                const renderedHtml = md.renderer.render(sectionTokens, options as any, {})
                return renderedHtml
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
                if (field as any === "question") {
                    // TODO
                    //  Generating the question body from Markdown:
                    // - skip "body"
                    // - skip "question/challenge"
                    // - skip whole section for brochures
                    // - make question strong
                    // - add interactivity instructions in em tags

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
                const htmlContent = prettifySectionHtml(renderedHtml, taskFile, true)
                newContent[`${placeholderTitlePrefix}Html`] = htmlContent
                newContent[`${placeholderTitlePrefix}Hash`] = md5(htmlContent)
                newContent[`${placeholderTitlePrefix}Source`] = "markdown"
            }

            const modified = await writeOrMerge(targetFile, newContent, overwrite, overwriteAll, context)
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


async function runCheckImagesOn(tasks: TaskSpec[], showPresent: boolean, unique: boolean, context: ServerTaskContext): Promise<void> {

    let numMissing = 0
    let numPresent = 0
    const cachedResults: Record<string, boolean> = {}
    const urlExistsCached = async (url: string): Promise<boolean> => {
        if (url in cachedResults) {
            return cachedResults[url]
        }
        const exists = await urlExists(url, 3000)
        cachedResults[url] = exists
        return exists
    }

    await BottomProgressBar.showWhile(tasks.length, async pbar => {
        for (const { taskFile, taskIdWithLang, serverTaskId } of tasks) {
            pbar.update(taskIdWithLang)

            const targetFile = serverFileForTaskFile(taskFile)
            if (!fs.existsSync(targetFile)) {
                fatalError(`Target server HTML file does not exist for graphics check: ${targetFile} `)
            }

            const content = fs.readFileSync(targetFile, 'utf-8')
            const $ = cheerio.load(content)

            const imgElements = $('img')

            const missing: [serverUrl: string, localPath: string | undefined, sectionId: string | undefined][] = []
            const present: typeof missing = []

            for (const imgElem of imgElements.toArray()) {
                const parent = $(imgElem).closest('div.task-section')
                const parentId = parent.attr('id')
                const src = $(imgElem).attr('src')
                if (src) {
                    const fullUrl = `${context.baseUrl}${src}`
                    if (!unique || !(fullUrl in cachedResults)) {
                        const localSrc = $(imgElem).attr('data-local-src')
                        const urlExists = await urlExistsCached(fullUrl)
                        const targetList = urlExists ? present : missing
                        targetList.push([src, localSrc, parentId])
                    }
                }
            }

            // anything to show?
            const doShowMissing = missing.length > 0
            const doShowPresent = showPresent && present.length > 0
            if (doShowMissing || doShowPresent) {
                const prefix = showPresent ? "For" : "Missing images for"
                console.log(`${prefix} task ${taskIdWithLang} (server ID: ${serverTaskId}):`)
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

function parseServerJson(json: unknown, taskId: string, serverTaskId: number, context: ServerTaskContext): ServerHTMLParts | undefined {
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
            if (typeof jsonValue === "string" || typeof jsonValue === "number" || typeof jsonValue === "boolean") {
                value = String(jsonValue)
            } else {
                warn(`Field ${serverField} has unexpected type in server JSON`)
            }
            if (parser && value !== undefined) {
                value = parser(value)
            }
        }
        yamlData[localField] = value ?? defaultValue
    }

    // Data consistency checks
    const taskIdFromYaml = String(yamlData.id)
    if (taskIdFromYaml !== taskId) {
        warn(`Warning: taskId mismatch: expected ${taskId}, got ${taskIdFromYaml}`)
    }
    if (Number(yamlData.serverId) !== serverTaskId) {
        warn(`Warning: serverTaskId mismatch: expected ${serverTaskId}, got ${yamlData.serverId}`)
    }
    const graderName = context.graders.getName(Number(yamlData.grader))
    if (graderName === undefined) {
        warn(`Warning: grader name not found for grader ID ${yamlData.grader}`)
        yamlData.grader = `<unknown grader id ${yamlData.grader}>`
    } else {
        yamlData.grader = graderName
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
        baseUrl: context.baseUrl,
        htmlTitle: `${yamlData.id} — ${yamlData.title}-${yamlData.lang}`,
        taskTitle: yamlData.title,
        taskId: yamlData.id,
        yamlMetadata: yaml.dump(yamlData, { indent: 4 }).trim(),
        graderSpec: (json as any)['que_answers']?.trim() ?? "",
        questionHtml, questionHash, questionSource: source,
        answerHtml, answerHash, answerSource: source,
        itsinformaticsHtml, itsinformaticsHash, itsinformaticsSource: source,
    }

    return content
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

function getCuttleApiKey(hostname: string): string {
    // Get the CUTTLEAPIKEY from macOS Keychain
    try {
        const key = execSync(
            `security find-generic-password -a bebras -s "cuttle_question_api:${hostname}" -w`,
            { encoding: "utf8" }
        ).trim()
        if (key.length === 0) {
            throw new Error("Empty key")
        }
        return key
    } catch (err) {
        fatalError("Cuttle API key not found in macOS Keychain; add it using:\n" +
            `  security add-generic-password -a bebras -s "cuttle_question_api:${hostname}" -w <API_KEY>\n` +
            "where <API_KEY> is your Cuttle question API key.")
    }
}
