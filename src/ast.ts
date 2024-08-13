import * as fs from 'fs'
import * as path from 'path'
import { parseMarkdown } from './convert_html'
import Token = require('markdown-it/lib/token')

import * as codes from './codes'
import { util } from './main'
import * as patterns from './patterns'
import { defaultOutputFile, Difficulty, mkdirsOf, modificationDateIsLater, parseLanguageCodeFromTaskPath, readFileStrippingBom, TaskMetadata } from "./util"


export type TaskAST_Saved = Omit<TaskMetadata, "contributors" | "support_files"> & {
    lang?: string
    lang_code?: string

    parsed_id: ParsedID

    difficulties: number[]
    ages: {
        [level: number]: Difficulty
    }
    contributors: ParsedContributor[]
    support_files: ParsedSupportFile[]
}

export type TaskAST = TaskAST_Saved & {
    filepath: string
    filename: string

    difficulty?: number // transient, difficulty for a given category
    difficulty_str?: Difficulty // same
}

export type ParsedID = {
    year: number
    country: string
    country_code: string
    num: number
    variant?: string
    usage_year?: number
}

export interface ParsedContributor {
    src: string
    name: string
    country: string
    country_code: string
    roles: string[]
    email?: string
}

export interface ParsedSupportFile {
    src: string
    file_pattern: string

    authors?: string[]
    source?: string
    license?: string
}

export async function astOf(taskFile: string, forceRegen: boolean = false): Promise<TaskAST> {
    const jsonFile = defaultOutputFile(taskFile, "json")
    if (forceRegen || !fs.existsSync(jsonFile) || await modificationDateIsLater(taskFile, jsonFile)) {
        // console.log("Generating AST for " + path.basename(taskFile))
        const ast = await buildASTOf(taskFile)
        try {
            await mkdirsOf(jsonFile)
            await fs.promises.writeFile(jsonFile, JSON.stringify(ast, undefined, 4))
        } catch (err) {
            console.log("Couldn't write cached AST: " + (err as any).message)
        }
        return enrichAST(ast, taskFile)
    } else {
        // console.log("Loading cached AST from " + path.basename(jsonFile))
        return loadASTFrom(jsonFile, taskFile)
    }
}

async function loadASTFrom(jsonFile: string, taskFile: string): Promise<TaskAST> {
    const contents = await readFileStrippingBom(jsonFile)
    const savedAST = JSON.parse(contents) as TaskAST_Saved // TODO validate JSON
    return enrichAST(savedAST, taskFile)
}

export async function buildASTOf(taskFile: string): Promise<TaskAST_Saved> {
    const mdText = await readFileStrippingBom(taskFile)
    const langCode = parseLanguageCodeFromTaskPath(taskFile)
    const [tokens, metadata] = parseMarkdown(mdText, taskFile, path.dirname(taskFile), { langCode })
    return toJsonRepr(tokens, taskFile, metadata)
}

function toJsonRepr(tokens: Token[], taskFile: string, metadata: TaskMetadata): TaskAST_Saved {
    let parsedMetadata: Partial<TaskAST> = {
        ...metadata,
        difficulties: [],
        contributors: [],
        support_files: [],
    }

    for (let i = 0; i < util.AgeCategories.length; i++) {
        const diffStr = metadata.ages[util.AgeCategories[i]]
        const diffIndex = util.Difficulties.indexOf(diffStr)
        parsedMetadata.difficulties!.push(diffIndex)
        parsedMetadata.ages![i] = diffStr
    }

    let match

    if (match = patterns.taskFileName.exec(path.basename(taskFile))) {
        let lang_code
        if (lang_code = match.groups.lang_code) {
            parsedMetadata.lang_code = lang_code
            parsedMetadata.lang = codes.languageNameAndShortCodeByLongCode[lang_code]?.[0]
        }
    }

    if (match = patterns.idWithOtherYear.exec(metadata.id)) {
        const country_code = match.groups.country_code

        const parsedId: ParsedID = {
            year: +match.groups.year,
            country_code: country_code,
            country: codes.countryNameByCountryCodes[country_code]!,
            num: +match.groups.num,
        }
        if (match.groups.variant) {
            parsedId.variant = match.groups.variant
        }
        if (match.groups.usage_year) {
            parsedId.usage_year = +match.groups.usage_year
        }
        parsedMetadata.parsed_id = parsedId
    }


    for (const contribStr of metadata.contributors) {
        if (match = patterns.contributor.exec(contribStr)) {
            const country = match.groups.country
            const contributor: ParsedContributor = {
                src: contribStr,
                name: match.groups.name,
                country,
                country_code: codes.countryCodeByCountryName[country]!,
                roles: match.groups.roles.split(/, */),
            }
            if (match.groups.email) {
                contributor.email = match.groups.email
            }
            parsedMetadata.contributors!.push(contributor)
        }
    }

    for (const supportFileStr of metadata.support_files) {
        if (match = patterns.supportFile.exec(supportFileStr)) {
            const supportFile: ParsedSupportFile = {
                src: supportFileStr,
                file_pattern: match.groups.file_pattern,
            }
            if (match.groups.by) {
                supportFile.authors = match.groups.author_ext!
                    .split(/(?:, *)|(?: +and +)/)
                    .map(auth_ext => {
                        return auth_ext.replace(/^.*by /, "")
                    })
                if (match.groups.license_by) {
                    supportFile.license = match.groups.license_by
                }
            } else if (match.groups.from) {
                supportFile.source = match.groups.source
                if (match.groups.license_from) {
                    supportFile.license = match.groups.license_from
                }
            }
            parsedMetadata.support_files!.push(supportFile)
        }
    }

    return parsedMetadata as TaskAST_Saved
}

function enrichAST(savedAST: TaskAST_Saved, taskFile: string): TaskAST {
    const enriched: TaskAST = {
        filename: path.basename(taskFile),
        filepath: taskFile,
        ...savedAST,
    }
    return enriched
}

