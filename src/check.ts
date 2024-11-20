import * as fs from 'fs'
import * as yaml from "js-yaml"
import * as _ from 'lodash'
import * as path from "path"

import * as minimatch from "minimatch"
import * as codes from './codes'
import * as patterns from './patterns'
import { Category, TaskYear } from "./patterns"
import { AgeCategories, AgeCategory, Check, DifficultyLevels, ErrorMessage, TaskMetadata, TaskMetadataField, Value, isArray, isErrorMessage, isNullOrUndefined, isRecord, isString, isStringArray, isUndefined, levenshteinDistance, mkStringCommaAnd, s } from "./util"


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

/**
 * Returns the source year, so the year of the format according to which this task should be structured
 */
export function postYamlLoadObjectCorrections(loadedMetadata: Record<string, unknown>): TaskYear {

    // remove the backslash from '\*' strings
    function removeBackslashFromStarStrings(values: unknown) {
        if (isStringArray(values)) {
            for (let i = 0; i < values.length; i++) {
                const str: string = values[i]
                if (str.startsWith("\\*")) {
                    values[i] = str.substring(1)
                }
            }
        }
    }
    removeBackslashFromStarStrings(loadedMetadata.support_files)

    // get id to perform migrations if needed
    let id, parsedId
    let sourceYear: TaskYear = "latest"
    if (isString(id = loadedMetadata.id) && (parsedId = TaskMetadata.parseId(id))) {
        let currentYearOfData: TaskYear = parsedId.usage_year ?? parsedId.year
        sourceYear = currentYearOfData
        // console.log(`Loading metadata from year ${currentYearOfData}`)
        if (currentYearOfData <= 2021) {
            // migrate to 2022
            if (typeof loadedMetadata.computer_science_areas === "undefined") {
                loadedMetadata.computer_science_areas = loadedMetadata.categories
                delete loadedMetadata.categories
            }
            if (typeof loadedMetadata.computational_thinking_skills === "undefined") {
                loadedMetadata.computational_thinking_skills = []
            }
            currentYearOfData = 2022
        }
        if (currentYearOfData === 2022) {
            // migrate to latest
            if (typeof loadedMetadata.categories === "undefined") {
                loadedMetadata.categories = loadedMetadata.computer_science_areas
                delete loadedMetadata.computer_science_areas
            }
            currentYearOfData = "latest"
        }
    }

    // parse subcategories
    const categories = loadedMetadata.categories
    if (isStringArray(categories)) {
        const newCats: patterns.Category[] = []
        // just one level here
        for (const cat of categories) {
            const [mainCatName, ...subCatNames] = cat.split(" - ")
            const newCat: patterns.Category = { name: mainCatName, subs: subCatNames.map(s => ({ name: s, subs: [] })) }
            newCats.push(newCat)
        }
        loadedMetadata.categories = newCats
    }

    return sourceYear
}

type ErrorWarningCallback = (range: readonly [number, number], msg: string) => void

export function loadRawMetadata(text: string, warn?: ErrorWarningCallback, error?: ErrorWarningCallback): [number, number, string, string, Record<string, unknown>, TaskYear, number, string] | undefined {

    const metadataStringCheck = metadataStringFromContents(text)

    if (isErrorMessage(metadataStringCheck)) {
        error?.([0, 1], metadataStringCheck.error)
        return
    }

    const [fmStart, fmEnd, fmStrRaw, fmStr, mdStart, mdStr] = metadataStringCheck.value

    function fmRangeFromException(e: yaml.YAMLException): [[number, number], string] {
        const msg = e.toString(true).replace("YAMLException: ", "")
        const errPos = e.mark?.position
        if (errPos === undefined) {
            return [[fmStart, fmEnd], msg]
        } else {
            const start = fmStart + errPos
            return [[start, start + 1], msg]
        }
    }

    let metadata: Record<string, unknown> = {}
    try {
        metadata = yaml.load(fmStr, {
            onWarning: (e: yaml.YAMLException) => {
                const [range, msg] = fmRangeFromException(e)
                warn?.(range, `Malformed metadata markup: ${msg}`)
            },
        }) as Record<string, unknown>
    } catch (e) {
        if (e instanceof yaml.YAMLException) {
            const [range, msg] = fmRangeFromException(e)
            error?.(range, `Malformed metadata markup: ${msg}`)
            return
        }
    }

    const sourceYear = postYamlLoadObjectCorrections(metadata)

    return [fmStart, fmEnd, fmStrRaw, fmStr, metadata, sourceYear, mdStart, mdStr]
}

export async function check(text: string, taskFile: string, strictChecks: boolean, validateAsYear?: TaskYear, _formatVersion?: string): Promise<LintOutput[]> {

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

        const [fmStart, fmEnd, fmStrRaw, fmStr, metadata, sourceYear, mdStart, mdStr] = loadResult

        function mdRangeForValueInMatch(substring: string, match: { index: number, [i: number]: string }): [number, number] {
            const offset = match[0].indexOf(substring)
            const start = mdStart + match.index + offset
            const end = start + substring.length
            return [start, end]
        }

        const imageDefs: Record<string, string> = {}

        function checkImageDef(ref: string, range: () => [number, number]) {
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

                error(range(), "Referenced file not found." + suggStr, QuickFixReplacements(sugg.map(s => s.replacement)))
            }
        }

        for (const pattern of [patterns.mdInlineImage, patterns.mdLinkRef]) {
            let match
            while (match = pattern.exec(mdStr)) {
                const ref = match.groups.filename
                if (ref.startsWith("http://") || ref.startsWith("https://")) {
                    continue
                }
                const label = match.groups.label
                if (label !== "") {
                    imageDefs[label] = ref
                }
                const _match = match // make compiler happy
                checkImageDef(ref, () => mdRangeForValueInMatch(ref, _match))
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

        function fmRangeForAgeValue(cat: AgeCategory): [number, number] {
            let start = fmStrRaw.indexOf(cat) + cat.length
            let c
            while ((c = fmStrRaw.charCodeAt(start)) === 0x20 /* ' ' */ || c === 0x3A /* : */) {
                start++
            }
            const end = fmStrRaw.indexOf("\n", start)
            return [start + fmStart, end + fmStart]
        }


        const idFull = metadata.id
        let mainCountry: string | undefined
        let match
        if (isUndefined(idFull)) {
            error([fmStart, fmEnd], "The id field is missing")
        } else if (!isString(idFull)) {
            error(fmRangeForDef("id"), "The task ID should be a plain string")
        } else if (match = patterns.idWithOtherYear.exec(idFull)) {

            const idPlain = match.groups.id_plain
            if (!filename.startsWith(idPlain)) {
                error(fmRangeForValueInDef("id", idPlain), `The filename '${filename}' does not match this ID`)
            } else {
                const trimmedFilename = filename.slice(idPlain.length)
                if (trimmedFilename.length !== 0) {
                    if (!trimmedFilename.startsWith("-")) {
                        error([0, 3], `The filename must have the format ID[-lan]${patterns.taskFileExtension} where 'lan' is the 3-letter ISO 639-3 code for the language`)
                    } else {
                        const languageCode = trimmedFilename.slice(1)
                        if (isUndefined(codes.languageNameAndShortCodeByLongCode[languageCode])) {
                            error([0, 3], `Unknown language code '${languageCode}' in filename`)
                        }
                    }
                }
            }

            const countryCode = match.groups.country_code ?? "ZZ"
            mainCountry = codes.countryNameByCountryCodes[countryCode]
            if (isUndefined(mainCountry)) {
                let [start, _] = fmRangeForValueInDef("id", idPlain)
                start += 5
                warn([start, start + 2], "This country code looks invalid")
            }
        } else {
            error(fmRangeForValueInDef("id", idFull), `The task ID should have the format YYYY-CC-00[x], possibly with a '(for YYYY)' specifier\n\nPattern:\n${patterns.idWithOtherYear.source}`)
        }

        const requiredFields = patterns.requiredMetadataFieldsCurrentFor(validateAsYear ?? sourceYear, strictChecks)

        const missingFields = [] as string[]
        for (let f of requiredFields) {
            if (isNullOrUndefined((metadata as any)[f])) {
                missingFields.push(f)
            }
        }

        if (missingFields.length !== 0) {
            error([0, 3], `Missing definition${s(missingFields.length)}: ${missingFields.join(", ")}`)
            // Don't return: it may be useful to check the other fields as well
            // return
        }

        const title = metadata.title
        if (!isString(title) || title.length === 0) {
            error(fmRangeForDef("title"), "The title should be a nonempty string")
        } else if (title.includes("TODO")) {
            warn(fmRangeForValueInDef("title", "TODO"), "The title contains a TODO")
        }

        if (!isRecord(metadata.ages)) {
            error(fmRangeForDef("ages"), "The title should be a nonempty string")
        } else {
            const missingAgeCats = [] as string[]
            for (let ageCat of AgeCategories) {
                const ageDiff = metadata.ages?.[ageCat]
                if (isNullOrUndefined(ageDiff)) {
                    missingAgeCats.push(ageCat)
                }
            }

            if (missingAgeCats.length !== 0) {
                error(fmRangeForDef("ages"), `Missing age group${s(missingAgeCats.length)}: ${missingAgeCats.join(", ")}`)
            } else {

                let lastLevel = NaN
                let numDefined = 0 + AgeCategories.length
                let closed = false
                const LevelNotApplicable = "--"
                const LevelNotApplicableKnownGap = "----"
                for (let ageCat of AgeCategories) {
                    const classif = `${metadata.ages?.[ageCat] ?? LevelNotApplicable}`
                    let level: number
                    if (classif === LevelNotApplicable || classif === LevelNotApplicableKnownGap) {
                        level = NaN
                        numDefined--
                        if (!isNaN(lastLevel) && classif !== LevelNotApplicableKnownGap) {
                            closed = true
                        }
                    } else if (classif in DifficultyLevels) {
                        level = (DifficultyLevels as any)[classif]
                    } else {
                        error(fmRangeForAgeValue(ageCat), `Invalid value '${classif}', should be one of easy, medium, hard, or ${LevelNotApplicable} if not applicable`, QuickFixReplacements(["easy", "medium", "hard", "bonus", LevelNotApplicable]))
                        return
                    }

                    if (level > lastLevel) {
                        error(fmRangeForAgeValue(ageCat), `Inconsistent value, this should not be more difficult than the previous age group`)
                    }

                    if (!isNaN(level) && closed) {
                        const range = fmRangeForAgeValue(AgeCategories[AgeCategories.indexOf(ageCat) - 1])
                        warn(range, `There is a gap in the age definitions. Use ${LevelNotApplicableKnownGap} to signal it's meant to be so.`, QuickFixReplacements([LevelNotApplicableKnownGap]))
                        closed = false
                    }

                    lastLevel = level
                }

                if (numDefined === 0) {
                    warn(fmRangeForDef("ages"), `No age groups haven been assigned`)
                }
            }
        }


        const answerTypes = patterns.answerTypesFor(sourceYear)
        const answerType = metadata.answer_type
        if (!isString(answerType)) {
            error(fmRangeForDef("answer_type"), "The answer type must be a plain string")
        } else if (!answerTypes.includes(answerType as any)) {
            warn(fmRangeForValueInDef("answer_type", answerType), `Answer type '${answerType}' is not recognized. Expected one of:\n  - ${answerTypes.join("\n  - ")}`, QuickFixReplacements(answerTypes))
        }

        const categories = metadata.categories
        if (!isArray(categories)) {
            error(fmRangeForDef("categories"), "The categories must be a (hierarchical) list of plain strings")
        } else {
            function validateCategoriesRecursively(foundCats: Category[], validCats: Category[], parentCat: string | undefined) {
                for (const foundCat of foundCats) {
                    const validCat = validCats.find(c => c.name === foundCat.name)
                    if (isUndefined(validCat)) {
                        const category = parentCat ? `subcategory '${foundCat.name}' for parent '${parentCat}'` : `category '${foundCat.name}'`
                        error(fmRangeForValueInDef("categories", "- " + foundCat.name), `Invalid ${category}, should be one of:\n  - ${validCats.map(c => c.name).join("\n  - ")}`, QuickFixReplacements(validCats.map(c => "- " + c.name)))
                    } else {
                        validateCategoriesRecursively(foundCat.subs, validCat.subs, foundCat.name)
                    }
                }
            }

            validateCategoriesRecursively(categories, patterns.categories, undefined)
        }

        if (sourceYear === 2022) {
            const validCTSkills = patterns.ctSkills as readonly string[]
            const computational_thinking_skills = metadata.computational_thinking_skills
            if (!isStringArray(computational_thinking_skills)) {
                error(fmRangeForDef("computational_thinking_skills"), "The computational thinking skills must be a list of plain strings")
            } else {
                _.filter(computational_thinking_skills, c => !validCTSkills.includes(c)).forEach(c => {
                    error(fmRangeForValueInDef("computational_thinking_skills", c), `Invalid computational thinking skill '${c}', should be one of:\n  - ${validCTSkills.join("\n  - ")}`, QuickFixReplacements(validCTSkills))
                })
                if (_.uniq(computational_thinking_skills).length !== computational_thinking_skills.length) {
                    warn(fmRangeForDef("computational_thinking_skills"), `The computational thinking skills should be unique`)
                }
            }
        }

        const contributors = metadata.contributors
        const supportFileContributors = new Set<string>()

        if (!isStringArray(contributors)) {
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
                                    if (isUndefined(codes.languageLongCodeByLanguageName[lang])) {
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
        if (!isStringArray(keywords)) {
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
        if (!isStringArray(supportFiles)) {
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
            const [baseFolder, existingSupportFiles] = await findAllSupportFilesFor(taskFile)
            const ignoredSupportFiles = new Set<string>(["reviews.txt"])

            for (const existingFile of existingSupportFiles) {
                if (ignoredSupportFiles.has(existingFile)) {
                    continue
                }
                let matchedBy: string | undefined = undefined
                for (const pattern of allFilePatterns) {
                    if (minimatch(existingFile, "**/" + pattern)) {
                        matchedBy = pattern
                        unmatchedFilePatterns.delete(pattern)
                        break
                    } else {
                    }
                }
                if (isUndefined(matchedBy) && fs.statSync(path.join(baseFolder, existingFile)).size > 0) {
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

        const equivalentTasks = metadata.equivalent_tasks
        if (!isUndefined(equivalentTasks) && !isString(equivalentTasks) && !isStringArray(equivalentTasks)) {
            error(fmRangeForDef("equivalent_tasks"), "The equivalent tasks must be a list of IDs or the string '--'")
        } else {
            const equivalentTasksArr = isString(equivalentTasks) ? equivalentTasks.split(",").map(s => s.trim()) : isUndefined(equivalentTasks) ? [] : equivalentTasks
            for (const equivalentTask of equivalentTasksArr) {
                if (equivalentTask === "--") {
                    continue
                }

                if (!(match = patterns.idPlain.exec(equivalentTask))) {
                    error(fmRangeForValueInDef("equivalent_tasks", equivalentTask), `The task ID should have the format YYYY-CC-00[x]\n\nPattern:\n${patterns.idPlain.source}`)
                }
            }
        }

        const summary = metadata.summary
        if (summary !== undefined && !isString(summary)) {
            error(fmRangeForDef("summary"), "The summary must be a string")
        }

        const preview = metadata.preview
        if (preview !== undefined) {
            if (!isString(preview)) {
                error(fmRangeForDef("preview"), "The main image must be a string")
            } else {
                // TODO we could allow refs but we'd have to resolve them at
                // some point for external applications, e.g. when parsing the
                // task metadata, and this is probably too costly
                // if (!(preview in imageDefs)) {
                if (preview.startsWith(patterns.previewTextPrefix)) {
                    if (!preview.endsWith(patterns.previewTextSuffix)) {
                        error(fmRangeForValueInDef("preview", preview), `The preview text should start with '${patterns.previewTextPrefix}' and end with '${patterns.previewTextSuffix}'`)
                    }
                } else {
                    checkImageDef(preview, () => fmRangeForValueInDef("preview", preview))
                }
                // }
            }
        }


        let searchFrom = fmEnd
        const missingSections = [] as string[]
        const secPrefix = "## "
        const markdownSectionNames = patterns.markdownSectionNamesFor(sourceYear)
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

export function reportDiagnostics(diags: LintOutput[], text: string, taskFile: string, report: (msg: string) => void) {
    for (const diag of diags) {
        const linePrefix = `${diag.type.toUpperCase()}: `
        const msgPrefix = _.pad("", linePrefix.length - 3, " ") + "| "
        const [line, offset] = lineOf(diag.start, text)
        const length = Math.min(line.length - offset, diag.end - diag.start)
        report(linePrefix + line)
        const highlight = msgPrefix + _.pad("", linePrefix.length - msgPrefix.length + offset, " ") + _.pad("", length, "^")
        report(highlight)
        report(msgPrefix + diag.msg.replace(/\n/g, '\n' + msgPrefix) + `\n`)
    }
}

function lineOf(position: number, source: string): [string, number] {
    let start = position - 1
    while (source.charCodeAt(start) !== 0x0A && start >= 0) {
        start--
    }
    start++

    const last = source.length - 1
    let end = start
    let c: number
    while ((c = source.charCodeAt(end)) !== 0x0A && c !== 13 && end <= last) {
        end++
    }

    let line = source.slice(start, end)
    let offset = position - start

    const ellipsis = "[...] "
    const cutoff = 100
    if (offset > cutoff) {
        line = ellipsis + line.slice(cutoff)
        offset -= cutoff - ellipsis.length
    }
    return [line, offset]
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
            const dist = levenshteinDistance(missingName, filename)
            if (dist <= 2) {
                suggs.push({ filename, filePath, dist })
            }

        }
    }

    suggs.sort((a, b) => a.dist - b.dist)
    return suggs.map(a => ({ replacement: a.filePath, displayAs: a.filename }))
}

export async function findAllSupportFilesFor(taskFile: string): Promise<[string, string[]]> {
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

    return [taskFolder, names]
}


export function formatTable(orig: string, eol: string): string {

    const SEP_BAR = "|"
    const SEP_DOUBLE_BAR = "‖"

    type Sep = typeof SEP_BAR | typeof SEP_DOUBLE_BAR | ""
    type Row = { cells: string[], seps: Sep[], hasTrailingBackslash: boolean, isHeaderLike: boolean }

    // TODO: this only makes sense for text on multiple lines with a backslash at the
    // end of the line, otherwise we can just decide not to care
    // const SMALLEST_MEANINGFUL_INDENT = "   "
    // const MAX_INSERTED_LEFT_INDENT = SMALLEST_MEANINGFUL_INDENT.length - 1

    // Parses a row
    function rowFromLine(line: string): Row {
        const isHeaderLike = patterns.tableHeaderOrSepPattern.test(line)
        let hasTrailingBackslash = false
        const cells: string[] = []
        const seps: Sep[] = []
        let lastSep = -1

        function pushCell(start: number, end: number) {
            const content = line.substring(start, end).trim()
            // if (!content.startsWith(SMALLEST_MEANINGFUL_INDENT)) {
            //     // if it is not a meaningful indent
            //     content = content.trimLeft()
            // }
            cells.push(content)
        }

        // first char, maybe a sep, maybe not
        if (line[0] === SEP_BAR || line[0] === SEP_DOUBLE_BAR) {
            seps.push(line[0])
            lastSep = 0
        } else {
            seps.push("")
        }

        // actual cells
        for (let i = 0; i < line.length; i++) {
            const c = line[i]
            if (c === SEP_BAR || c === SEP_DOUBLE_BAR) {
                seps.push(c)
                pushCell(lastSep + 1, i)
                lastSep = i
            }
        }

        // last cell
        if (lastSep < line.length - 1) {
            pushCell(lastSep + 1, line.length)
            seps.push("")
        }

        const lastCell = cells[cells.length - 1]
        if (lastCell === "\\") {
            cells.pop()
            seps.pop()
            hasTrailingBackslash = true
        } else if (lastCell.endsWith("\\")) {
            hasTrailingBackslash = true
            cells[cells.length - 1] = lastCell.substring(0, lastCell.length - 1).trimEnd()
        }

        return { cells, seps, hasTrailingBackslash, isHeaderLike }
    }

    const rows = orig
        .trimEnd()      // get rid of last eol and whitespace
        .split(/\r?\n/) // split lines
        .map(rowFromLine)


    // return if we don't have any rows
    const numCols = _.max(rows.map(row => row.cells.length))
    if (isUndefined(numCols)) {
        return orig
    }

    type HAlign = "l" | "c" | "r" | "j"
    type VAlign = "t" | "m" | "b"

    const cellSepLength = 3
    const widthCutoffForPadding = 110
    const padLines: boolean[] = new Array(rows.length).fill(true)

    const maxColWidths: number[] = new Array(numCols).fill(2)
    const hAligns: HAlign[] = new Array(numCols).fill("j")
    const vAligns: VAlign[] = new Array(numCols).fill("m")
    let headerRow = undefined as Row | undefined
    rows.forEach((row, rowIndex) => {
        const isHeader = headerRow === undefined && row.isHeaderLike
        if (isHeader) {
            headerRow = row
            for (let i = 0; i < row.cells.length; i++) {
                row.cells[i] = row.cells[i].replace(/--+/g, "--")
            }
        }
        const rowLength = row.cells.reduce((acc, cell) => acc + cell.length, cellSepLength * (numCols - 1))
        const skipLineForPadding = rowLength > widthCutoffForPadding
        padLines[rowIndex] = !skipLineForPadding
        row.cells.forEach((cell, colIndex) => {
            if (!skipLineForPadding) {
                maxColWidths[colIndex] = Math.max(maxColWidths[colIndex], cell.length)
            }
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

    const seps = headerRow?.seps ?? new Array(numCols + 1).fill(SEP_BAR)
    const hasClosingRightBar = seps[seps.length - 1] === SEP_DOUBLE_BAR

    rows.forEach((row, rowIndex) => {
        let emptyCell
        let pad: (cell: string, toPad: number, hAlign: HAlign) => string
        if (row.isHeaderLike) {
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
                        const firstHalf = Math.floor(toPad / 2)
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
            const alignsLeft = hAligns[colIndex] === "j" || hAligns[colIndex] === "l"
            const skipThisPadding = !padLines[rowIndex] ||
                // also don't pad last col if we can
                colIndex === numCols - 1 && alignsLeft && !row.isHeaderLike && !hasClosingRightBar && !row.hasTrailingBackslash
            if (skipThisPadding) {
                cellContent = cell
            } else {
                const toPad = maxColWidths[colIndex] - cell.length
                cellContent = pad(cell, toPad, hAligns[colIndex])
            }
            row.cells[colIndex] = cellContent
        })
    })

    function joinRow(row: Row): string {
        const parts = []
        if (seps[0] === SEP_DOUBLE_BAR) {
            parts.push(SEP_DOUBLE_BAR + " ")
        }
        parts.push(row.cells[0])
        for (let i = 1; i < row.cells.length; i++) {
            parts.push(" " + seps[i] + " " + row.cells[i])
        }
        if (hasClosingRightBar) {
            if (row.hasTrailingBackslash) {
                parts.push(" " + SEP_DOUBLE_BAR + "\\")
            } else {
                parts.push(" " + SEP_DOUBLE_BAR)
            }
        } else if (row.hasTrailingBackslash) {
            parts.push(" \\")
        }
        return parts.join("")
    }

    return rows.map(joinRow).join(eol) + eol
}
