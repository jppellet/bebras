import { execSync } from "child_process"
import { Command } from "commander"
import * as fs from 'fs'
import beautify from 'js-beautify'
import * as yaml from "js-yaml"
import fetch, { Response } from 'node-fetch'
import * as path from "path"


import { warn } from "console"
import { languageNameAndShortCodeByLongCode } from "../codes"
import { decodeHtmlEntitiesFromHtmlSegment, makeServerHTMLFile, parseServerHTMLFile, parseTask, ServerHTMLParts, ServerHtmlTemplatePlaceholders } from "../convert_html"
import { findTasksFilesOrEnsureIsTaskFile, siblingWithExtension, urlExists, writeData } from "../fsutil"
import { fatalError } from "../util"
import _ = require("lodash")
import cheerio = require('cheerio')
import Token = require("markdown-it/lib/token")

type Subcommand = "upload" | "download" | "insert" | "checkimages"

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

    addCommand("upload", "Uploads tasks to the Cuttle server", true, cmd)

    addCommand("download", "Downloads tasks from the Cuttle server", false, cmd)

    addCommand("insert", "Inserts sections into existing server HTML files", true, cmd, cmd => cmd

        .option('--overwrite', 'overwrite existing content in the target file(s)', false)
    )

    addCommand("checkimages", "Reports missing images on the Cuttle server", false, cmd)

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

    public readonly tasks = new ServerIDs("tasks", "ServerTaskIDs.csv")
    public readonly graders = new ServerIDs("graders", "ServerGraderIDs.csv")

    public constructor(
        public readonly hostname: string,
        public readonly apiKey: string,
        public readonly overwrite: boolean,
        public readonly debug: boolean,
    ) { }


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

async function serverAction(subcommand: Subcommand, hasFields: boolean, ...varargs: any[]) {
    varargs.pop() // remove command object
    const options = varargs.pop()
    const debug = !!options.debug
    const overwrite = !!options.overwrite
    const isRecursive = !!options.recursive
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

    const tasksFolder = path.dirname(path.dirname(taskFiles[0]))

    const apiKey = getCuttleApiKey()
    if (!apiKey) {
        fatalError("Cuttle API key not found in macOS Keychain")
    }

    const context = new ServerTaskContext("wettbewerb.informatik-biber.ch", apiKey, overwrite, debug)
    context.loadServerIDs(tasksFolder)

    if (debug) {
        console.log(`apiKey = ${apiKey}`)
        console.log(`tasksFolder = ${tasksFolder}`)
        console.log(`tasks.size = ${context.tasks.size}`)
        console.log(`graders.size = ${context.graders.size}`)
    }

    const runActionOn = (() => {
        switch (subcommand) {
            case "upload": return runUploadTaskOn.bind(null, fields!)
            case "download": return runDownloadTaskOn
            case "insert": return runInsertTaskOn.bind(null, fields!)
            case "checkimages": return runCheckImagesOn
        }
        throw new Error(`Unsupported subcommand: ${subcommand}`)
    })()

    for (const file of taskFiles) {
        const taskIdWithLang = file.split('/').pop()!.split('.')[0]
        const serverTaskId = context.tasks.getServerID(taskIdWithLang)
        if (serverTaskId === undefined) {
            warn(`No server task id mapping found for task id with lang: ${taskIdWithLang}, skipping file: ${file} `)
            continue
        }
        await runActionOn(file, taskIdWithLang, serverTaskId, context)
    }
}

async function runUploadTaskOn(fields: string[], taskFile: string, taskIdWithLang: string, serverTaskId: number, context: ServerTaskContext) {
    validateFields(fields)

    const targetFile = serverFileForTaskFile(taskFile)
    if (!fs.existsSync(targetFile)) {
        fatalError(`Target server HTML file does not exist for upload: ${targetFile} `)
    }
    const content = parseServerHTMLFile(fs.readFileSync(targetFile, 'utf-8'))

    const url = `https://${context.hostname}/admin/api/dbmanage/question/${serverTaskId}`


    const payload: Record<string, string> = {}
    for (const field of fields) {
        const { placeholderTitle, cuttleJsonFieldName } = AllFields[field]
        const sectionContent = String(content[placeholderTitle]).trim()
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

    console.log(`Uploaded task ${taskIdWithLang} (server ID: ${serverTaskId}) successfully.`)
}

async function runDownloadTaskOn(taskFile: string, taskIdWithLang: string, serverTaskId: number, context: ServerTaskContext) {
    const targetFile = serverFileForTaskFile(taskFile)
    const url = `https://${context.hostname}/admin/api/dbmanage/question/${serverTaskId}`

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
    const richHtml = serverJsonToRichHtml(data, taskIdWithLang, serverTaskId, context)
    if (richHtml === undefined) {
        fatalError("Failed to convert server JSON to rich HTML for task id " + serverTaskId)
    }

    await writeData(richHtml, targetFile, "Server state as HTML")
}

const AllFields: Record<string, { sectionTitle: string, placeholderTitle: ServerHtmlTemplatePlaceholders, cuttleJsonFieldName: string }> = {
    "answer": { sectionTitle: "Answer Explanation", placeholderTitle: "answerHtml", cuttleJsonFieldName: "que_explanation" },
    "itsinformatics": { sectionTitle: "This is Informatics", placeholderTitle: "itsinformaticsHtml", cuttleJsonFieldName: "que_background_info" },
}

function validateFields(fields: string[]): void {
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

async function runInsertTaskOn(fields: string[], taskFile: string, taskIdWithLang: string, serverTaskId: number, context: ServerTaskContext) {
    validateFields(fields)

    const targetFile = serverFileForTaskFile(taskFile)
    if (!fs.existsSync(targetFile)) {
        fatalError(`Target server HTML file does not exist for insertion: ${targetFile} `)
    }

    const { md, options, tokens } = await parseTask(taskFile)

    const newContent: Partial<ServerHTMLParts> = {}
    for (const field of fields) {
        const { sectionTitle, placeholderTitle } = AllFields[field]
        const sectionTokens = extractTokensForSection(sectionTitle, tokens)
        const renderedHtml = md.renderer.render(sectionTokens, options as any, {})
        const prettifiedHtml = prettifySectionHtml(renderedHtml, taskFile)
        newContent[placeholderTitle] = prettifiedHtml
    }

    const existingContent = parseServerHTMLFile(fs.readFileSync(targetFile, 'utf-8'))

    let skip = false
    for (const key of Object.keys(newContent)) {
        const existingContentSection = String(existingContent[key as keyof ServerHTMLParts]).trim()
        if (!context.overwrite && existingContentSection.length !== 0 && existingContentSection !== String(newContent[key as keyof ServerHTMLParts]).trim()) {
            warn(`Content for field ${key} already exists in target file ${targetFile}, use --overwrite to overwrite`)
            skip = true
        }
    }
    if (skip) {
        return
    }

    const newContentHtml = makeServerHTMLFile({ ...existingContent, ...newContent })
    await writeData(newContentHtml, targetFile, `Server as HTML with inserted fields ${fields.join(", ")}`)
}

async function runCheckImagesOn(taskFile: string, taskIdWithLang: string, serverTaskId: number, context: ServerTaskContext) {
    const targetFile = serverFileForTaskFile(taskFile)
    if (!fs.existsSync(targetFile)) {
        fatalError(`Target server HTML file does not exist for graphics check: ${targetFile} `)
    }

    const content = fs.readFileSync(targetFile, 'utf-8')
    const $ = cheerio.load(content)

    const imgElements = $('img')
    const missingImages: string[] = []
    for (const imgElem of imgElements.toArray()) {
        const src = $(imgElem).attr('src')
        if (src) {
            const fullUrl = `https://${context.hostname}${src}`
            // console.log(`Checking image URL: ${fullUrl}`)
            if (!await urlExists(fullUrl, 3000)) {
                missingImages.push(src)
            }
        }
    }

    if (missingImages.length > 0) {
        warn(`Missing images detected for task ${taskIdWithLang} (server ID: ${serverTaskId}):`)
        for (const img of missingImages) {
            warn(` - ${img}`)
        }
    }
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

function serverJsonToRichHtml(json: unknown, taskId: string, serverTaskId: number, context: ServerTaskContext): string | undefined {
    if (Array.isArray(json) && json.length === 1) {
        json = json[0]
    }

    if (typeof json !== "object" || json === null) {
        return undefined
    }

    type FieldDef<T> = T extends string
        ? [serverName: string, localName: string, defaultValue: string]
        : [serverName: string, localName: string, defaultValue: T, parser: (s: string) => T]

    const fieldsForYaml = [
        ["que_identifier", "id", "0000-AA-00-eng"],
        ["que_version", "lang", "n/a"],
        ["que_year", "year", 1900, Number],
        ["que_id", "serverId", 0, Number],
        ["que_name", "title", "n/a"],
        ["que_grd_id", "grader", 0, Number],
    ] as const satisfies FieldDef<string | number>[]

    type YamlField = typeof fieldsForYaml[number][1]

    const yamlData: Record<YamlField, string | number> = {} as any
    for (const [serverField, localField, defaultValue, parser] of fieldsForYaml) {
        let value: string | number | undefined = undefined
        if (!(serverField in json)) {
            warn(`Field ${serverField} not found in server JSON`)
        } else {
            const jsonValue = json[serverField as keyof typeof json]
            if (typeof jsonValue === "string" || typeof jsonValue === "number") {
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

    const content: ServerHTMLParts = {
        baseUrl: `https://${context.hostname}/`,
        htmlTitle: `${yamlData.id} — ${yamlData.title}-${yamlData.lang}`,
        taskTitle: yamlData.title,
        taskId: yamlData.id,
        yamlMetadata: yaml.dump(yamlData, { indent: 4 }).trim(),
        graderSpec: (json as any)['que_answers']?.trim() ?? "",
        questionHtml: prettifySectionHtml((json as any)['que_content'], false),
        answerHtml: prettifySectionHtml((json as any)['que_explanation'], false),
        itsinformaticsHtml: prettifySectionHtml((json as any)['que_background_info'], false),
    }

    const serverHtml = makeServerHTMLFile(content)

    // verify by parsing back
    const parsedContent = parseServerHTMLFile(serverHtml)
    if (!_.isEqual(parsedContent, content)) {
        warn(`Warning: parsed content does not match generated content for task id ${taskId}`)
        warn("Generated fields from server data:", content)
        warn("Parsed fields from saved HTML:", parsedContent)
    }

    return serverHtml
}

function prettifySectionHtml(rawHtml: string | undefined, transformImagesFromTaskFile: string | false): string {
    if (!rawHtml) {
        return ""
    }
    const withDecodedEntities = decodeHtmlEntitiesFromHtmlSegment(rawHtml, transformImagesFromTaskFile)
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

function getCuttleApiKey(): string | undefined {
    // Get the CUTTLEAPIKEY from macOS Keychain; it can be stored there using:
    // security add-generic-password -a biber -s cuttle_question_api -w CUTTLEAPIKEY
    try {
        const key = execSync(
            'security find-generic-password -a biber -s cuttle_question_api -w',
            { encoding: "utf8" }
        ).trim()
        return key
    } catch (err) {
        return undefined
    }
}
