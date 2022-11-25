import * as path from "path"
import * as yaml from "js-yaml"
import * as _ from 'lodash'
import * as fs from 'fs'

import * as codes from './codes'
import * as patterns from './patterns'
import { isNullOrUndefined, s, isString, isUndefined, isArray, TaskMetadata, Check, ErrorMessage, Value, isErrorMessage, TaskMetadataField, mkStringCommaAnd } from "./util"
import { util } from "./main"
import * as minimatch from "minimatch"
import { TaskYear } from "./patterns"


export type Severity = "error" | "warn"

export type QuickFixReplacements = {
    _type: "replacement"
    values: readonly string[]
}
function QuickFixReplacements(values: readonly string[]): QuickFixReplacements {
    return { _type: "replacement", values }
}

export type QuickFixAdditions = {
    _type: "additions"
    field: TaskMetadataField
    newValues: readonly string[]
}
function QuickFixAdditions(field: TaskMetadataField, newValues: readonly string[]): QuickFixAdditions {
    return { _type: "additions", field, newValues }
}

export type QuickFix =
    | QuickFixReplacements
    | QuickFixAdditions

export type LintOutput = {
    type: Severity,
    start: number,
    end: number,
    msg: string,
    quickFix?: QuickFix
}

export function metadataStringFromContents(text: string): Check<[number, number, string, string, number, string]> {
    const metadataSep = "---"
    const metadataStartLF = metadataSep + '\n'
    const metadataStartCRLF = metadataSep + '\r\n'
    let metadataStart: string
    let newline: string
    if (text.startsWith(metadataStartLF)) {
        metadataStart = metadataStartLF
        newline = "\n"
    } else if (text.startsWith(metadataStartCRLF)) {
        metadataStart = metadataStartCRLF
        newline = "\r\n"
    } else {
        return ErrorMessage(`Metadata should open before this, on the first line, with '${metadataSep}'`)
    }

    const fmStart = metadataStart.length
    const metadataStop = newline + metadataSep + newline
    const fmEnd = text.indexOf(metadataStop)
    if (fmEnd < 0) {
        return ErrorMessage(`Metadata opened here is not closed with '${metadataSep}'`)
    }
    const fmStrRaw = text.slice(fmStart, fmEnd)
    const fmStr = normalizeRawMetadataToStandardYaml(fmStrRaw)
    const mdStart = fmEnd + metadataStop.length
    const mdStr = text.slice(mdStart)
    return Value([fmStart, fmEnd, fmStrRaw, fmStr, mdStart, mdStr])
}

export function normalizeRawMetadataToStandardYaml(rawFromFile: string): string {
    return rawFromFile.replace(patterns.supportFileStarCorrection, "$1\\*$2")
}

export function postYamlLoadObjectCorrections<T extends object>(obj: T) {
    for (const [key, value] of Object.entries(obj)) {
        if (isArray(value) && _.every(value, isString)) {
            for (let i = 0; i < value.length; i++) {
                const str: string = value[i]
                if (str.startsWith("\\*")) {
                    value[i] = str.substring(1)
                }
            }
        }
    }
}

type ErrorWarningCallback = (range: readonly [number, number], msg: string) => void

export function loadRawMetadata(text: string, warn?: ErrorWarningCallback, error?: ErrorWarningCallback): [number, number, string, string, Partial<TaskMetadata>, number, string] | undefined {

    const metadataStringCheck = metadataStringFromContents(text)

    if (isErrorMessage(metadataStringCheck)) {
        error?.([0, 1], metadataStringCheck.error)
        return
    }

    const [fmStart, fmEnd, fmStrRaw, fmStr, mdStart, mdStr] = metadataStringCheck.value

    function fmRangeFromException(e: yaml.YAMLException): [[number, number], string] {
        const msg = e.toString(true).replace("YAMLException: ", "")
        // @ts-ignore
        let errPos = e.mark?.position
        // @ts-ignore
        if (errPos === undefined) {
            return [[fmStart, fmEnd], msg]
        } else {
            const start = fmStart + parseInt(errPos)
            return [[start, start + 1], msg]
        }
    }

    let metadata: Partial<TaskMetadata> = {}
    try {
        metadata = yaml.load(fmStr, {
            onWarning: (e: yaml.YAMLException) => {
                const [range, msg] = fmRangeFromException(e)
                warn?.(range, `Malformed metadata markup: ${msg}`)
            },
        }) as Partial<TaskMetadata>
    } catch (e) {
        if (e instanceof yaml.YAMLException) {
            const [range, msg] = fmRangeFromException(e)
            error?.(range, `Malformed metadata markup: ${msg}`)
            return
        }
    }

    postYamlLoadObjectCorrections(metadata)

    return [fmStart, fmEnd, fmStrRaw, fmStr, metadata, mdStart, mdStr]
}

export function adjustLoadedMetadataFor(year: TaskYear, metadata: Partial<TaskMetadata>) {
    if (year <= 2021) {
        metadata.computer_science_areas = (metadata as any).categories
        metadata.computational_thinking_skills = []
    }
}


export async function check(text: string, taskFile: string, _formatVersion?: string): Promise<LintOutput[]> {

    const parentFolder = path.dirname(taskFile)
    let filename: string = path.basename(taskFile)
    if (filename.endsWith(patterns.taskFileExtension)) {
        filename = filename.slice(0, filename.length - patterns.taskFileExtension.length)
    }

    const diags = [] as LintOutput[]

    function newDiag([start, end]: readonly [number, number], msg: string, sev: Severity, quickFix?: QuickFix) {
        diags.push({ type: sev, start, end, msg, quickFix })
    }

    function warn(range: readonly [number, number], msg: string, quickFix?: QuickFix) {
        newDiag(range, msg, "warn", quickFix)
    }

    function error(range: readonly [number, number], msg: string, quickFix?: QuickFix) {
        newDiag(range, msg, "error", quickFix)
    }

    await (async function () {

        const loadResult = loadRawMetadata(text, warn, error)
        if (isUndefined(loadResult)) {
            return
        }

        const [fmStart, fmEnd, fmStrRaw, fmStr, metadata, mdStart, mdStr] = loadResult

        function mdRangeForValueInMatch(substring: string, match: { index: number, [i: number]: string }): [number, number] {
            const offset = match[0].indexOf(substring)
            const start = mdStart + match.index + offset
            const end = start + substring.length
            return [start, end]
        }

        for (const pattern of [patterns.mdInlineImage, patterns.mdLinkRef]) {
            let match
            while (match = pattern.exec(mdStr)) {
                const ref = match.groups.filename
                if (ref.startsWith("http://") || ref.startsWith("https://")) {
                    continue
                }
                const refPath = path.join(parentFolder, ref)
                if (!fs.existsSync(refPath)) {
                    let suggStr = ""
                    const sugg = fileSuggestionsForMissing(refPath, taskFile)
                    if (sugg.length !== 0) {
                        if (sugg.length === 1) {
                            suggStr = ` Did you mean ${sugg[0].displayAs}?`
                        } else {
                            suggStr = ` Did you mean of the following? \n${sugg.map(s => s.displayAs).join("\n")}`
                        }
                    }

                    error(mdRangeForValueInMatch(ref, match), "Referenced file not found." + suggStr, QuickFixReplacements(sugg.map(s => s.replacement)))
                }
            }
        }

        function fmRangeForDef(field: TaskMetadataField): [number, number] {
            const start = fmStrRaw.indexOf('\n' + field) + 1 + fmStart
            const end = start + field.length
            return [start, end]
        }

        function fmRangeForValueInDef(field: TaskMetadataField, value: string): [number, number] {
            const fieldStart = fmStrRaw.indexOf('\n' + field)
            const start = fmStrRaw.indexOf(value, fieldStart + field.length) + fmStart
            const end = start + value.length
            return [start, end]
        }

        function fmRangeForAgeValue(cat: MetadataAgeCategory): [number, number] {
            let start = fmStrRaw.indexOf(cat) + cat.length
            let c
            while ((c = fmStrRaw.charCodeAt(start)) === 0x20 /* ' ' */ || c === 0x3A /* : */) {
                start++
            }
            const end = fmStrRaw.indexOf("\n", start)
            return [start + fmStart, end + fmStart]
        }

        const id = metadata.id
        let mainCountry: string | undefined
        let year: number | "latest" = "latest"
        let match
        if (isUndefined(id)) {
            error([fmStart, fmEnd], "The id field is missing")
        } else if (!isString(id)) {
            error(fmRangeForDef("id"), "The task ID should be a plain string")
        } else if (match = patterns.id.exec(id)) {

            if (!filename.startsWith(id)) {
                error(fmRangeForValueInDef("id", id), `The filename '${filename}' does not match this ID`)
            } else {
                const trimmedFilename = filename.slice(id.length)
                if (trimmedFilename.length !== 0) {
                    if (!trimmedFilename.startsWith("-")) {
                        error([0, 3], `The filename must have the format ID[-lan]${patterns.taskFileExtension} where 'lan' is the 3-letter ISO 639-3 code for the language`)
                    } else {
                        const languageCode = trimmedFilename.slice(1)
                        if (isUndefined(codes.languageNameByLanguageCode[languageCode])) {
                            error([0, 3], `Unknown language code '${languageCode}' in filename`)
                        }
                    }
                }
            }

            const countryCode = match.groups.country_code ?? "ZZ"
            mainCountry = codes.countryNameByCountryCodes[countryCode]
            year = parseInt(match.groups.year)
            if (isUndefined(mainCountry)) {
                let [start, _] = fmRangeForValueInDef("id", id)
                start += 5
                warn([start, start + 2], "This country code looks invalid")
            }
        } else {
            error(fmRangeForValueInDef("id", id), `The task ID should have the format YYYY-CC-00[x]\n\nPattern:\n${patterns.id.source}`)
        }

        adjustLoadedMetadataFor(year, metadata)

        const requiredFields = patterns.requiredMetadataFieldsCurrentFor(year)

        const missingFields = [] as string[]
        for (let f of requiredFields) {
            if (isNullOrUndefined((metadata as any)[f])) {
                missingFields.push(f)
            }
        }

        if (missingFields.length !== 0) {
            error([fmStart, fmEnd], `Missing definition${s(missingFields.length)}: ${missingFields.join(", ")}`)
            return
        }

        const title = metadata.title
        if (!isString(title) || title.length === 0) {
            error(fmRangeForDef("title"), "The title should be a nonempty string")
        } else if (title.includes("TODO")) {
            warn(fmRangeForValueInDef("title", "TODO"), "The title contains a TODO")
        }

        type MetadataAgeCategory = keyof NonNullable<typeof metadata.ages>
        const requiredAgeCats: Array<MetadataAgeCategory> = ["6-8", "8-10", "10-12", "12-14", "14-16", "16-19"]

        const missingAgeCats = [] as string[]
        for (let a of requiredAgeCats) {
            const ageDiff = metadata.ages?.[a]
            if (isNullOrUndefined(ageDiff)) {
                missingAgeCats.push(a)
            }
        }

        if (missingAgeCats.length !== 0) {
            error(fmRangeForDef("ages"), `Missing age group${s(missingAgeCats.length)}: ${missingAgeCats.join(", ")}`)
        } else {

            let lastLevel = NaN
            let numDefined = 0 + requiredAgeCats.length
            let closed = false
            const LevelNotApplicable = "--"
            const LevelNotApplicableKnownGap = "----"
            for (let a of requiredAgeCats) {
                const classif = `${metadata.ages?.[a] ?? LevelNotApplicable}`
                let level: number
                if (classif === LevelNotApplicable || classif === LevelNotApplicableKnownGap) {
                    level = NaN
                    numDefined--
                    if (!isNaN(lastLevel) && classif !== LevelNotApplicableKnownGap) {
                        closed = true
                    }
                } else if (classif === "easy") {
                    level = 1
                } else if (classif === "medium") {
                    level = 2
                } else if (classif === "hard") {
                    level = 3
                } else if (classif === "bonus") {
                    level = 4
                } else {
                    error(fmRangeForAgeValue(a), `Invalid value '${classif}', should be one of easy, medium, hard, or ${LevelNotApplicable} if not applicable`, QuickFixReplacements(["easy", "medium", "hard", "bonus", LevelNotApplicable]))
                    return
                }

                if (level > lastLevel) {
                    error(fmRangeForAgeValue(a), `Inconsistent value, this should not be more difficult than the previous age group`)
                }

                if (!isNaN(level) && closed) {
                    const range = fmRangeForAgeValue(requiredAgeCats[requiredAgeCats.indexOf(a) - 1])
                    error(range, `There is a gap in the age definitions. Use ${LevelNotApplicableKnownGap} to signal it's meant to be so.`, QuickFixReplacements([LevelNotApplicableKnownGap]))
                    closed = false
                }

                lastLevel = level
            }

            if (numDefined === 0) {
                warn(fmRangeForDef("ages"), `No age groups haven been assigned`)
            }
        }

        const answerTypes = patterns.answerTypesFor(year)
        const answerType = metadata.answer_type
        if (!isString(answerType)) {
            error(fmRangeForDef("answer_type"), "The answer type must be a plain string")
        } else if (!answerTypes.includes(answerType as any)) {
            warn(fmRangeForValueInDef("answer_type", answerType), `Answer type '${answerType}' is not recognized. Expected one of:\n  - ${answerTypes.join("\n  - ")}`, QuickFixReplacements(answerTypes))
        }

        const validCSAreas = patterns.csAreas as readonly string[]
        const computer_science_areas = metadata.computer_science_areas
        if (!isArray(computer_science_areas) || !_.every(computer_science_areas, isString)) {
            error(fmRangeForDef("computer_science_areas"), "The computer science areas must be a list of plain strings")
        } else {
            _.filter(computer_science_areas, c => !validCSAreas.includes(c)).forEach(c => {
                error(fmRangeForValueInDef("computer_science_areas", c), `Invalid computer science area '${c}', should be one of:\n  - ${validCSAreas.join("\n  - ")}`, QuickFixReplacements(validCSAreas))
            })
            if (_.uniq(computer_science_areas).length !== computer_science_areas.length) {
                warn(fmRangeForDef("computer_science_areas"), `The computer science areas should be unique`)
            }
        }

        const validCTSkills = patterns.ctSkills as readonly string[]
        const computational_thinking_skills = metadata.computational_thinking_skills
        if (!isArray(computational_thinking_skills) || !_.every(computational_thinking_skills, isString)) {
            error(fmRangeForDef("computational_thinking_skills"), "The computational thinking skills must be a list of plain strings")
        } else {
            _.filter(computational_thinking_skills, c => !validCTSkills.includes(c)).forEach(c => {
                error(fmRangeForValueInDef("computational_thinking_skills", c), `Invalid computational thinking skill '${c}', should be one of:\n  - ${validCTSkills.join("\n  - ")}`, QuickFixReplacements(validCTSkills))
            })
            if (_.uniq(computational_thinking_skills).length !== computational_thinking_skills.length) {
                warn(fmRangeForDef("computational_thinking_skills"), `The computational thinking skills should be unique`)
            }
        }

        const contributors = metadata.contributors
        const supportFileContributors = new Set<string>()

        if (!isArray(contributors) || !_.every(contributors, isString)) {
            error(fmRangeForDef("contributors"), "The contributors must be a list of strings")
        } else {
            const countries = [] as string[]
            const mainAuthorCountries = [] as string[]
            for (const c of contributors) {
                if (match = patterns.contributor.exec(c)) {
                    let email
                    if (email = match.groups.email) {
                        if (email.toLowerCase() !== email) {
                            warn(fmRangeForValueInDef("contributors", email), `Email addresses should be normalized to lowercase.`)
                        }
                    }
                    let country
                    if (country = match.groups.country) {
                        if (!countries.includes(country)) {
                            if (isUndefined(codes.countryCodeByCountryName[country])) {
                                let suggStr = ""
                                const sugg = codes.countrySuggestionsFor(country)
                                if (sugg.length !== 0) {
                                    if (sugg.length === 1) {
                                        suggStr = ` Did you mean ${sugg[0]}?`
                                    } else {
                                        suggStr = ` Did you mean of the following? ${sugg.join(", ")}`
                                    }
                                }
                                warn(fmRangeForValueInDef("contributors", country), `Country '${country}' is not recognized.${suggStr}\nNote: we know this may be a sensible topic and mean no offense if your country is not recognized here by mistake. Please contact us if you feel this is wrong.`, QuickFixReplacements(sugg))
                            }
                            countries.push(country)
                        }
                    }
                    const roles = match.groups.roles.split(new RegExp(", ?"))
                    for (const role of roles) {
                        if (role === patterns.roleMainAuthor) {
                            if (country) {
                                mainAuthorCountries.push(country)
                            }
                        } else if (patterns.supportFilesRoles.includes(role as any)) {
                            supportFileContributors.add(match.groups.name)
                        } else if (role.startsWith(patterns.roleTranslation)) {
                            let submatch
                            if (submatch = patterns.translation.exec(role)) {
                                function checkLang(lang: string) {
                                    if (isUndefined(codes.languageCodeByLanguageName[lang])) {
                                        let suggStr = ""
                                        const sugg = codes.languageSuggestionsFor(lang)
                                        if (sugg.length !== 0) {
                                            if (sugg.length === 1) {
                                                suggStr = ` Did you mean ${sugg[0]}?`
                                            } else {
                                                suggStr = ` Did you mean of the following? ${sugg.join(", ")}`
                                            }
                                        }
                                        warn(fmRangeForValueInDef("contributors", lang), `Language '${lang}' is not recognized.${suggStr}\nNote: we know this may be a sensible topic and mean no offense if your language is not recognized here by mistake. Please contact us if you feel this is wrong.`, QuickFixReplacements(sugg))
                                    }
                                }
                                checkLang(submatch.groups.from)
                                checkLang(submatch.groups.to)
                            } else {
                                warn(fmRangeForValueInDef("contributors", role), `The role '${patterns.roleTranslation}' should have the format:\ntranslation from <source language> into <target language>\n\nPattern:\n${patterns.translation.source}`)
                            }
                        } else if (!patterns.validRoles.includes(role as any)) {
                            warn(fmRangeForValueInDef("contributors", role), `Role '${role}' is not recognized. Expected one of:\n  - ${patterns.validRoles.join("\n  - ")}`, QuickFixReplacements(patterns.validRoles))
                        }
                    }
                } else {
                    warn(fmRangeForValueInDef("contributors", c), `Contributor should have the format:\nName, email, country (role[s])\nWrite [no email] if the email address is not known.\nMultiple roles should be separated by commas.\n\nPattern:\n${patterns.contributor.source}`)
                }
            }

            if (!isUndefined(mainCountry) && !mainAuthorCountries.includes(mainCountry)) {
                warn(fmRangeForDef("contributors"), `No contributor with role '${patterns.roleMainAuthor}' from country ${mainCountry} was found`)
            }
        }

        const keywords: string[] = ["TODO get from below"] //metadata.keywords // TODO: load this from main text, not YAML preamble, as it is localized 
        const seenKeywords = new Set<string>()
        const seenUrls = new Set<string>()
        if (!isArray(keywords) || !_.every(keywords, isString)) {
            error(fmRangeForDef("keywords"), "The keywords must be a list of strings")
        } else {
            const sep = " - "
            keywords.forEach(f => {
                let match
                if (match = patterns.keyword.exec(f)) {
                    const keyword = match.groups.keyword
                    if (seenKeywords.has(keyword)) {
                        warn(fmRangeForValueInDef("keywords", keyword), `Keyword '${keyword}' is mentioned several times`)
                    } else {
                        seenKeywords.add(keyword)
                    }
                    if (keyword.indexOf(sep) >= 0) {
                        warn(fmRangeForValueInDef("keywords", keyword), `Malformed keyword: should not contain ‘${sep}’ or should be followed by valid web URL`)
                    }
                    const urlsStr = match.groups.urls
                    if (urlsStr) {
                        const urls = urlsStr.split(/ *, */)
                        for (const url of urls) {
                            if (seenUrls.has(url)) {
                                warn(fmRangeForValueInDef("keywords", url), `URL '${url}' is mentioned several times`)
                            } else {
                                seenUrls.add(url)
                            }
                        }
                    }
                } else {
                    warn(fmRangeForValueInDef("keywords", f), `This line should have the format:\n<keyword>\n  or\n<keyword>${sep}<url>[, <url>]\n\nPattern:\n${patterns.keyword.source}`)
                }
            })
        }

        const supportFiles = metadata.support_files
        if (!isArray(supportFiles) || !_.every(supportFiles, isString)) {
            error(fmRangeForDef("support_files"), "The support files must be a list of strings")
        } else {
            const seenGraphicsContributors = new Set<string>()
            const allFilePatterns: string[] = []

            supportFiles.forEach(f => {
                let match
                if (match = patterns.supportFile.exec(f)) {
                    const filePattern = match.groups.file_pattern
                    allFilePatterns.push(filePattern)

                    const ByMarker = "by "
                    if (match.groups.by === "by") {
                        // "by" case
                        const authorExt = match.groups.author_ext ?? ""
                        const authorParts = authorExt.split(", ")
                        for (const authorPart of authorParts) {
                            const byPos = authorPart.indexOf(ByMarker)
                            if (byPos === -1) {
                                warn(fmRangeForValueInDef("support_files", authorPart), `This part should have the format:\n<work> by <author>`)
                            } else {
                                const authorNames = authorPart.substring(byPos + ByMarker.length).split(" and ")
                                for (const authorName of authorNames) {
                                    if (!supportFileContributors.has(authorName)) {
                                        warn(fmRangeForValueInDef("support_files", authorName), `Person '${authorName}' is not mentioned in the contributor list with role ${mkStringCommaAnd(patterns.supportFilesRoles.map(r => "'" + r + "'"), "or")}`)
                                    }
                                    seenGraphicsContributors.add(authorName)
                                }

                            }
                        }
                        // TODO validate license
                    } else if (match.groups.from === "from") {
                        // "from" case
                        // TODO validate license
                    } else {
                        warn(fmRangeForValueInDef("support_files", f), `Inconsistency; we'd need either a 'from' or a 'by' here.\n\nPattern:\n${patterns.supportFile.source}`)
                    }
                } else {
                    warn(fmRangeForValueInDef("support_files", f), `This line should have the format:\n<file_pattern> by <author>[, <work> by <author>] (<license>) [if omitted, the license is assumed to be ${patterns.DefaultLicenseShortTitle}]\n--or--\n<file_pattern> from <source> (<license>) [license cannot be omitted]\n\nPattern:\n${patterns.supportFile.source}`)
                }
            })
            for (const seenGraphicsContributor of seenGraphicsContributors) {
                supportFileContributors.delete(seenGraphicsContributor)
            }
            for (const unseenGraphicsContributor of supportFileContributors) {
                warn(fmRangeForValueInDef("contributors", unseenGraphicsContributor), `Person '${unseenGraphicsContributor}' has the role ${mkStringCommaAnd(patterns.supportFilesRoles.map(r => "'" + r + "'"), "and/or")} but is not listed in the details for the support files`)
            }

            const unmatchedFilePatterns = new Set<string>(allFilePatterns)
            const unlistedSupportFiles: string[] = []
            const existingSupportFiles = await findAllSupportFilesFor(taskFile)

            for (const existingFile of existingSupportFiles) {
                let matchedBy: string | undefined = undefined
                for (const pattern of allFilePatterns) {
                    if (minimatch(existingFile, "**/" + pattern)) {
                        matchedBy = pattern
                        unmatchedFilePatterns.delete(pattern)
                        break
                    } else {
                    }
                }
                if (isUndefined(matchedBy)) {
                    unlistedSupportFiles.push(existingFile)
                }
            }

            for (const unmatchedFilePattern of unmatchedFilePatterns) {
                warn(fmRangeForValueInDef("support_files", unmatchedFilePattern), `This file pattern does not match any existing files`)
            }

            if (unlistedSupportFiles.length !== 0) {
                warn(fmRangeForDef("support_files"), "The following files are not matched by any declaration here:\n" + unlistedSupportFiles.join("\n"), QuickFixAdditions("support_files", unlistedSupportFiles.map(f => f + " by ???")))
            }

        }

        let searchFrom = fmEnd
        const missingSections = [] as string[]
        const secPrefix = "## "
        const markdownSectionNames = patterns.markdownSectionNamesFor(year)
        markdownSectionNames.forEach(secName => {
            const secMarker = secPrefix + secName
            const secStart = text.indexOf('\n' + secMarker, searchFrom)
            if (secStart < 0) {
                missingSections.push(secMarker)
            } else {
                searchFrom = secStart + secMarker.length
            }
        })

        if (missingSections.length !== 0) {
            error([fmEnd, text.length], `Missing or misplaced required section${s(missingSections.length)}:\n${missingSections.join("\n")}\n\nSections are expected in this order:\n${secPrefix}${markdownSectionNames.join("\n" + secPrefix)}`)
        }

    })()

    return diags
}

function fileSuggestionsForMissing(missingFile: string, taskFile: string): { replacement: string, displayAs: string }[] {
    const taskContainerPrefix = path.dirname(taskFile) + path.sep
    const parent = path.dirname(missingFile)
    if (!fs.existsSync(parent)) {
        return []
    }

    const suggs = []
    const missingName = path.basename(missingFile)
    for (const filename of fs.readdirSync(parent)) {
        let filePath = path.join(parent, filename)
        if (fs.statSync(filePath).isFile()) {
            if (filePath.startsWith(taskContainerPrefix)) {
                filePath = filePath.substring(taskContainerPrefix.length)
            }
            const dist = util.levenshteinDistance(missingName, filename)
            if (dist <= 2) {
                suggs.push({ filename, filePath, dist })
            }

        }
    }

    suggs.sort((a, b) => a.dist - b.dist)
    return suggs.map(a => ({ replacement: a.filePath, displayAs: a.filename }))
}

export async function findAllSupportFilesFor(taskFile: string): Promise<string[]> {
    const taskFolder = path.dirname(taskFile)
    const names: string[] = []

    let prefixSegments: string[] = []
    await walkExistingFolder(taskFolder, [".task.md", ".html", ".odt", "derived"])

    async function walkExistingFolder(folder: string, excludeSuffixPatterns: string[]) {
        const localNames = await fs.promises.readdir(folder)
        fileScan: for (const localName of localNames) {
            if (localName.startsWith(".")) {
                continue fileScan
            }
            for (const excludeSuffixPattern of excludeSuffixPatterns) {
                if (localName.endsWith(excludeSuffixPattern)) {
                    continue fileScan
                }
            }
            const localFile = path.join(folder, localName)
            const stats = await fs.promises.stat(localFile)
            if (stats.isFile()) {
                let subpath = path.join(...prefixSegments, localName)
                if (path.sep === "\\") {
                    subpath = subpath.replace(/\\/g, "/")
                }
                names.push(subpath)
            } else if (stats.isDirectory()) {
                prefixSegments.push(localName)
                await walkExistingFolder(path.join(folder, localName), excludeSuffixPatterns)
                prefixSegments.pop()
            }
        }
    }

    return names
}


export function formatTable(orig: string, eol: string): string {

    type Row = { cells: string[], hasTrailingBackslash: boolean }

    function rowFromLine(line: string): Row {
        let hasTrailingBackslash = false
        const cells = line.split(/(?:\||‖)/)
            .filter(cell => cell.length !== 0) // filter out last/first empty cells
            .map(cell => cell.trim())          // make sure we do the job of adding whitespace back // TODO: this may strip 3+ more spaces at the beginning, which have semantic meaning! Don't strip!
        const lastCell = cells[cells.length - 1]
        if (lastCell === "\\") {
            cells.pop()
            hasTrailingBackslash = true
        } else if (lastCell.endsWith("\\")) {
            hasTrailingBackslash = true
            cells[cells.length - 1] = lastCell.substring(0, lastCell.length - 1).trimEnd()
        }
        return { cells, hasTrailingBackslash }
    }

    const rows = orig
        .trimEnd()      // get rid of last eol and whitespace
        .split(/\r?\n/) // split lines
        .map(rowFromLine)

    const numCols = _.max(rows.map(row => row.cells.length))
    if (isUndefined(numCols)) {
        return orig
    }
    const addOpeningTrainingBars = numCols > 2
    const headerContent = /:?(?:\^|v)?\-+:?/

    type HAlign = "l" | "c" | "r" | "j"
    type VAlign = "t" | "m" | "b"

    const maxColWidths = new Array(numCols).fill(2)
    const hAligns: HAlign[] = new Array(numCols).fill("j")
    const vAligns: VAlign[] = new Array(numCols).fill("m")
    let headerRow = -1
    let headerSeen = false
    rows.forEach((row, rowIndex) => {
        const isHeader = !headerSeen && _.every(row.cells, cell => headerContent.test(cell))
        if (isHeader) {
            headerRow = rowIndex
            for (let i = 0; i < row.cells.length; i++) {
                row.cells[i] = row.cells[i].replace(/--+/g, "--")
            }
        }
        row.cells.forEach((cell, colIndex) => {
            maxColWidths[colIndex] = Math.max(maxColWidths[colIndex], cell.length)
            if (isHeader) {
                let hAlign: HAlign
                let vAlign: VAlign
                let strippedCell
                const leftAnchor = cell.startsWith(":")
                const rightAnchor = cell.endsWith(":") || cell.endsWith("+")
                if (leftAnchor) {
                    strippedCell = cell.substring(1)
                    if (rightAnchor) {
                        hAlign = "c"
                    } else {
                        hAlign = "l"
                    }
                } else {
                    strippedCell = cell
                    if (rightAnchor) {
                        hAlign = "r"
                    } else {
                        hAlign = "j"
                    }
                }
                hAligns[colIndex] = hAlign
                if (strippedCell.startsWith("^")) {
                    vAlign = "t"
                } else if (strippedCell.startsWith("v")) {
                    vAlign = "b"
                } else {
                    vAlign = "m"
                }
                vAligns[colIndex] = vAlign
            }
        })
    })


    rows.forEach((row, rowIndex) => {
        const isHeader = headerRow === rowIndex
        let emptyCell
        let pad: (cell: string, toPad: number, hAlign: HAlign) => string
        if (isHeader) {
            headerSeen = true
            emptyCell = "--"
            pad = (cell, toPad, _align) => {
                const mid = Math.floor(cell.length / 2)
                return cell.substring(0, mid) + _.pad("", toPad, "-") + cell.substring(mid)
            }
        } else {
            emptyCell = "  "
            pad = (cell, toPad, hAlign) => {
                switch (hAlign) {
                    case "l":
                    case "j":
                        return cell + _.pad("", toPad, " ")
                    case "r":
                        return _.pad("", toPad, " ") + cell
                    case "c":
                        const firstHalf = Math.min(2, Math.floor(toPad / 2)) // not more than 2, otherwise interpreted as code
                        const secondHalf = toPad - firstHalf
                        return _.pad("", firstHalf, " ") + cell + _.pad("", secondHalf, " ")
                }
            }
        }
        for (let c = row.cells.length; c < numCols; c++) {
            row.cells.push(emptyCell)
        }
        row.cells.forEach((cell, colIndex) => {
            let cellContent
            if (!addOpeningTrainingBars && colIndex === numCols - 1 && headerRow === 0) {
                // Don't pad last col
                cellContent = cell
            } else {
                const toPad = maxColWidths[colIndex] - cell.length
                cellContent = pad(cell, toPad, hAligns[colIndex])
            }
            row.cells[colIndex] = cellContent
        })
    })

    const [linePrefix, lineSuffix] = addOpeningTrainingBars ? ["| ", " |"] : ["", ""]
    const getLineSuffix = (r: Row) => r.hasTrailingBackslash ? " \\" : lineSuffix

    return rows.map(row => linePrefix + row.cells.join(" | ") + getLineSuffix(row)).join(eol) + eol
}
