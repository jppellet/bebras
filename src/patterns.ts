// The following allows us to type to some extend
// the groups property of the RegExpExecArray object

import { isString } from "markdown-it/lib/common/utils"
import { TaskMetadata } from "./util"

// @ts-ignore
interface RichRegExpExecArray<T> extends globalThis.RegExpExecArray {
    groups: T
}

// @ts-ignore
interface RichRegExp<T> extends globalThis.RegExp {
    exec(string: string): RichRegExpExecArray<T> | null;
}

// OFFeslint-disable-next-line @typescript-eslint/class-name-casing
interface always { _tag: 'always' };
// OFFeslint-disable-next-line @typescript-eslint/class-name-casing
interface maybe { _tag: 'maybe' };

type Captures<T> = {
    [G in keyof T]: T[G] extends always ? string : T[G] extends maybe ? (string | undefined) : never;
}

export type GroupNameOf<T> = T extends RichRegExp<infer H> ? keyof H : never

function capturing<T>(pat: RegExp): RichRegExp<Captures<T>>
function capturing<T>(pat: string, flags?: string): RichRegExp<Captures<T>>

function capturing<T>(patOrRegexp: RegExp | string, flags?: string): RichRegExp<Captures<T>> {
    return (isString(patOrRegexp) ? new RegExp(patOrRegexp, flags) : patOrRegexp) as RichRegExp<Captures<T>>
}


// Some useful metadata-related functions

export class LicenceInfo {
    constructor(
        public year: string,
        public title: string,
        public titleShort: string,
        public url: string,
        public imageUrl: string,
    ) { }

    shortCopyright(): string {
        return `© ${this.year} Bebras (${this.titleShort})`
    }

    fullCopyright(): string {
        return `Copyright © ${this.year} Bebras – International Contest on Informatics and Computer Fluency. This work is licensed under a ${this.title}.`
    }
}

export function genLicense(metadata: TaskMetadata): LicenceInfo {
    return new LicenceInfo(
        /* year:       */ metadata.id.slice(0, 4),
        /* title:      */ "Creative Commons Attribution – ShareAlike 4.0 International License",
        /* titleShort: */ "CC BY-SA 4.0",
        /* url:        */ "https://creativecommons.org/licenses/by-sa/4.0/",
        /* imageUrl:   */ "https://mirrors.creativecommons.org/presskit/buttons/88x31/svg/by-sa.svg",
    )
}

export const DefaultLicenseShortTitle = "CC BY-SA 4.0"


// String and structured constants

export const taskFileExtension =
    ".task.md"

export const ageCategories = {
    "6yo–8yo": "6-8",
    "8yo–10yo": "8-10",
    "10yo–12yo": "10-12",
    "12yo–14yo": "12-14",
    "14yo–16yo": "14-16",
    "16yo–19yo": "16-19",
} as const

export const categories = [
    "algorithms and programming",
    "data structures and representations",
    "computer processes and hardware",
    "communication and networking",
    "interactions, systems and society",
] as const

export const answerTypes = [
    "multiple choice",
    "multiple choice with images",
    "multiple select",
    "dropdown select",
    "open integer",
    "open text",
    "interactive (click-on-object)",
    "interactive (drag-and-drop)",
    "interactive (other)",
] as const

export const markdownSectionNames = [
    "Body",
    "Question/Challenge",
    "Answer Options/Interactivity Description",
    "Answer Explanation",
    "It's Informatics",
    "Keywords and Websites",
    "Wording and Phrases",
    "Comments",
] as const

export type SectionName = typeof markdownSectionNames[number]
export type SectionAssociatedData<T> = { [S in SectionName]: T }

export function isStandardSectionName(sectionName: string): sectionName is SectionName {
    return markdownSectionNames.includes(sectionName as any)
}

export const roleMainAuthor = "author"
export const roleGraphics = "graphics"
export const roleContributor = "contributor"
export const roleSupportFiles = "support files"
export const roleTranslation = "translation"
export const roleInteractivity = "interactivity"
export const roleInspiration = "inspiration"
export const validRoles = [roleMainAuthor, roleContributor, roleGraphics, roleSupportFiles, roleInteractivity, roleTranslation, roleInspiration] as const
export const supportFilesRoles = [roleGraphics, roleSupportFiles, roleInteractivity] as const


// Regexes without captures (reused several times in other patterns)

export const webUrl =
    /https?:\/\/[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[^\s;,]*)/g

export const email =
    /(?:[a-zA-Z0-9_\-\.]+)@(?:(?:\[[0-9]{1,10}\.[0-9]{1,10}\.[0-9]{1,10}\.)|(?:(?:[a-zA-Z0-9\-]+\.)+))(?:[a-zA-Z]{2,10}|[0-9]{1,10})(?:\]?)/g

export const decimal = // 5, 0.5, 5.0005...
    /\d+\.?\d*/g


// Regexes with semi-typed captures

export const prologue = capturing<{
    format: always,
    version: maybe
}>(
    /^\-{3}\r?\n(?:format: *Bebras Task(?: (?<version>[0-9\.]+))?\r?\n)?/
)

const idPatternWithoutStartEndMarkers = "(?<year>[0-9]{4})-(?<country_code>[A-Z]{2})-(?<num>[0-9]{2})(?<variant>[a-z])?"

export const id = capturing<{
    year: always,
    country_code: always,
    num: always,
    variant: maybe,
}>(
    `^${idPatternWithoutStartEndMarkers}$`
)

export const taskFileName = capturing<{
    id: always,
    year: always,
    country_code: always,
    num: always,
    variant: maybe,
    lang_code: maybe,
}>(
    `^(?<id>${idPatternWithoutStartEndMarkers})(?:\\-(?<lang_code>[a-z]{3}))?\\.task\\.md$`
)

export const mdInlineImage = capturing<{
    label: always,
    filename: always,
    title: maybe,
}>(
    /!\[(?<label>[^\]]*)\]\((?<filename>.*?)\s*(?=\"|\))(?:\"(?<title>.*)\")?\)/g
)

export const mdLinkRef = capturing<{
    label: always,
    filename: always,
    title: maybe,
}>(
    /^\[(?<label>[^\]]*)\]:\s*(?<filename>.*?)\s*(?=\"|\))(?:\"(?<title>.*)\")?\s*$/gm
)

export const translation = capturing<{
    from: always,
    to: always,
}>(
    "^" + roleTranslation + " from (?<from>.*) into (?<to>.*)$"
)

export const contributor = capturing<{
    name: always,
    country: always,
    email: maybe,
    roles: always,
}>(
    "^(?<name>[^\\(\\)]*), (?:\\[no email\\]|(?<email>" + email.source + ")), (?<country>[^,\\(\\)]*) \\((?<roles>[^\\(\\)]*)\\)$"
)

export const keyword = capturing<{
    keyword: always,
    urls: maybe,
}>(
    "^(?<keyword>.+?)(?: - (?<urls>" + webUrl.source + "(?:, +" + webUrl.source + ")*))? *$"
)

export const supportFile = capturing<{
    file_pattern: always,

    // first case when by === "by"
    by: maybe
    author_ext: maybe,
    license_by: maybe,

    // second case when from === "from"
    from: maybe
    source: maybe,
    license_from: maybe,
}>(
    "^(?<file_pattern>.*?) (?:(?<author_ext>(?<by>by) .*)( \\((?<license_by>.*)\\))?|(?<from>from) (?<source>.*) \\((?<license_from>.*)\\))$"
)

export const supportFileStarCorrection = capturing<{
    pre: always
    post: always
}>(
    /^(?<pre>\s*-\s*)\*(?<post>.*)$/gm
)


export const imageOptions = capturing<{
    width_abs: maybe,
    width_rel: maybe,
    width_min: maybe,
    width_max: maybe,
    height_abs: maybe,
    placement: maybe,
}>(
    "\\s*\\((?:(?<width_abs>" + decimal.source + "?)(?:px)?|(?<width_rel>" + decimal.source + "%)(?: min (?<width_min>" + decimal.source + ")(?:px)?)?(?: max (?<width_max>" + decimal.source + ")(?:px)?)?)(?: ?x ?(?<height_abs>" + decimal.source + ")(?:px)?)?(?: +(?<placement>left|right))?\\)"
)


export const texInlineNumbersPattern = capturing<{
    pre: always,
    n: always,
    post: always,
}>(
    // any number not followed by '-' or '_' ('_' will have been prefixed by \ by now)
    "(?<pre>\\b)(?<n>([\\+\\-])?[\\d]+(?:\\.[\\d]+)?)(?=[^\\-\\\\])(?<post>\\b)", "g"
)


