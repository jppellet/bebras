// The following allows us to type to some extend
// the groups property of the RegExpExecArray object

import { TaskMetadata } from "./util"

// @ts-ignore
interface RichRegExpExecArray<T> extends globalThis.RegExpExecArray {
    groups: T
}

// @ts-ignore
interface RichRegExp<T> extends globalThis.RegExp {
    exec(string: string): RichRegExpExecArray<T> | null;
}

// eslint-disable-next-line @typescript-eslint/class-name-casing
interface always { _tag: 'always' };
// eslint-disable-next-line @typescript-eslint/class-name-casing
interface maybe { _tag: 'maybe' };

type Captures<T> = {
    [G in keyof T]: T[G] extends always ? string : T[G] extends maybe ? (string | undefined) : never;
}

export type GroupNameOf<T> = T extends RichRegExp<infer H> ? keyof H : never

function capturing<T>(pat: string, flags?: string): RichRegExp<Captures<T>> {
    return new RegExp(pat, flags) as RichRegExp<Captures<T>>
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

export const roleMainAuthor = "author"
export const roleGraphics = "graphics"
export const roleContributor = "contributor"
export const roleTranslation = "translation"
export const roleInspiration = "inspiration"
export const validRoles = [roleMainAuthor, roleContributor, roleGraphics, roleTranslation, roleInspiration] as const


// Regexes without captures (reused several times in other patterns)

export const webUrl =
    new RegExp("https?:\\/\\/[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b(?:[^\\s;,]*)", "g")

export const email =
    new RegExp("(?:[a-zA-Z0-9_\\-\\.]+)@(?:(?:\\[[0-9]{1,10}\\.[0-9]{1,10}\\.[0-9]{1,10}\\.)|(?:(?:[a-zA-Z0-9\\-]+\\.)+))(?:[a-zA-Z]{2,10}|[0-9]{1,10})(?:\\]?)", "g")

export const decimal = // 5, 0.5, 5.0005...
    new RegExp("\\d+\\.?\\d*", "g")

export const texCharsPattern =
    // we escape these: \ % _ $ &
    new RegExp("[\\\\%_\\$&]", "g")


// Regexes with semi-typed captures

export const prologue = capturing<{
    format: always,
    version: maybe
}>(
    "^\\-{3}\\n(?:format: *Bebras Task(?: (?<version>[0-9\\.]+))?\\n)?"
)

export const id = capturing<{
    year: always,
    country_code: always,
    num: always,
    variant: maybe,
}>(
    "^(?<year>[0-9]{4})-(?<country_code>[A-Z]{2})-(?<num>[0-9]{2})(?<variant>[a-z])?$"
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
    filename: always,
    author_ext: always,
    license: maybe,
}>(
    "^(?<filename>.*?) (?<author_ext>by [^\\(\\)]*)( \\((?<license>.*)\\))?$"
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


