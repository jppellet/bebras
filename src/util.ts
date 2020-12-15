import path = require('path')
import patterns = require('./patterns')
import fs = require('fs-extra')
import codes = require("./codes")

export type Dict<T> = Record<string, T | undefined>

export function keysOf<K extends keyof any>(d: Record<K, any>): K[]
export function keysOf<K extends {}>(o: K): (keyof K)[]

export function keysOf(o: any) {
    return Object.keys(o)
}

export class RichStringEnum<K extends keyof any, P> {

    static withProps<P0>() {
        return function <K0 extends keyof any>(defs: Record<K0, P0>) {
            return new RichStringEnum<K0, P0>(defs)
        }
    }

    private _values: Array<K>

    private constructor(private props: Record<K, P>) {
        this._values = keysOf(props)
        for (let i = 0; i < this._values.length; i++) {
            this[i] = this._values[i]
        }
    }

    get type(): K {
        throw new Error()
    }

    get values(): Array<K> {
        return this._values
    }

    get length(): number {
        return this._values.length
    }

    get definitions(): Array<[K, P]> {
        const defs: Array<[K, P]> = []
        for (let i of this._values) {
            defs.push([i, this.props[i]])
        }
        return defs
    }

    isValue(val: string | number | symbol): val is K {
        return this.values.includes(val as any)
    }

    indexOf(val: K): number {
        return this.values.indexOf(val)
    }

    propsOf(key: K): P {
        return this.props[key]
    }

    [i: number]: K

    *[Symbol.iterator]() {
        for (let i of this._values) {
            yield i
        }
    }

}

export function isString(a: any): a is string {
    return typeof a === 'string'
}

export function isArray(a: any): a is Array<any> {
    return Array.isArray(a)
}

export function isUndefined(a: any): a is undefined {
    return a === undefined
}

export function isNullOrUndefined(a: any): a is undefined | null {
    return a === null || a === undefined
}

export function mkStringCommaAnd(items: Array<any>): string {
    const len = items.length
    switch (len) {
        case 0: return ""
        case 1: return "" + items[0]
        case 2: return "" + items[0] + " and " + items[1]
        default:
            const parts: Array<string> = []
            items.forEach((item, index) => {
                parts.push("" + item)
                if (index < len - 2) {
                    parts.push(", ")
                } else if (index < len - 1) {
                    parts.push(", and ")
                }
            })
            return parts.join("")
    }
}

export function fatalError(msg: string): never {
    console.log("error: " + msg)
    process.exit(1)
}

interface CheckBase<A> {
    fold<B>(f: (a: A) => B, g: (err: string) => B): B
}

export function foldCheck<A, B>(this: Check<A>, f: (a: A) => B, g: (err: string) => B): B {
    switch (this._type) {
        case "Value": return f(this.value)
        case "ErrorMessage": return g(this.error)
        default:
            const unreachable: never = this
            throw new Error("match not exaustive: " + unreachable)
    }
}

export interface ErrorMessage extends CheckBase<never> {
    _type: "ErrorMessage"
    error: string,
}
export interface Value<A> extends CheckBase<A> {
    _type: "Value"
    value: A
}
export function ErrorMessage<A>(error: string): Check<A> {
    return { _type: "ErrorMessage", error, fold: foldCheck }
}
export function Value<A>(value: A): Check<A> {
    return { _type: "Value", value, fold: foldCheck }
}

export type Check<A> = ErrorMessage | Value<A>

export function plural(sing: string, plur: string, n: number): string {
    return (n === 1) ? sing : plur
}

export function s(n: number) {
    return plural("", "s", n)
}

export function siblingWithExtension(filepath: string, ext: string) {
    let filename = path.basename(filepath, patterns.taskFileExtension)
    filename = path.basename(filename, path.extname(filename))
    const siblingName = filename + ext
    return path.join(path.dirname(filepath), siblingName)
}


export function modificationDateIsLater(source: string, derived: string): boolean {
    return fs.statSync(source).mtimeMs > fs.statSync(derived).mtimeMs
}


export function toFileUrl(filepath: string): string {
    let pathName = path.resolve(filepath).replace(/\\/g, '/')

    // Windows drive letter must be prefixed with a slash
    if (pathName[0] !== '/') {
        pathName = '/' + pathName
    }

    return encodeURI('file://' + pathName)
};

export const OutputFormats = RichStringEnum.withProps<{
    pathSegments: string[]
    extension: string
}>()({
    html: { pathSegments: [], extension: ".html" },
    pdf: { pathSegments: ["derived"], extension: ".pdf" },
    tex: { pathSegments: ["derived"], extension: ".tex" },
    json: { pathSegments: ["derived"], extension: ".task.json" },
})

export type OutputFormat = typeof OutputFormats.type

export const Difficulties = ["--", "easy", "medium", "hard"] as const
export type Difficulty = typeof Difficulties[number]

export const AgeCategories = ["6-8", "8-10", "10-12", "12-14", "14-16", "16-19"] as const
export type AgeCategory = typeof AgeCategories[number]


export interface TaskMetadata {
    id: string
    title: string
    ages: { [key in AgeCategory]: Difficulty }
    categories: string[]
    answer_type: string
    keywords: string[]
    support_files: string[]
    contributors: string[]
}

export function defaultTaskMetadata(): TaskMetadata {
    return {
        id: "0000-AA-01",
        title: "((Untitled Task))",
        ages: {
            "6-8": "--",
            "8-10": "--",
            "10-12": "--",
            "12-14": "--",
            "14-16": "--",
            "16-19": "--",
        } as const,
        categories: [],
        keywords: [],
        support_files: [],
        answer_type: "((unspecified))",
        contributors: ["((unspecified))"],
    }
}


const texExpansionDefs: Dict<string | { pat: string, repl: string }> = {
    // basic chars expanded with backslash: & $ { } % _ #
    // (https://tex.stackexchange.com/a/34586/5035)
    "&": { pat: "\\&", repl: "\\&" },
    "$": { pat: "\\$", repl: "\\$" },
    "{": { pat: "\\{", repl: "\\{" },
    "}": { pat: "\\}", repl: "\\}" },
    "%": "\\%",
    "_": "\\_",
    "#": "\\#",

    // basic chars expanded with command
    "\\": { pat: "\\\\", repl: "\\textbackslash{}" },
    "^": { pat: "\\^", repl: "\\textasciicircum{}" },
    "~": "\\textasciitilde{}",

    // spaces
    "\u00A0": "~",
    "\u202F": "\\thinspace{}",

    // special 'go-through' backslash and curlies
    "⍀": "\\",
    "⦃": "{",
    "⦄": "}",

    // UTF chars expanded with command
    // More: https://github.com/joom/latex-unicoder.vim/blob/master/autoload/unicoder.vim
    "→": "\\ensuremath{\\rightarrow}",
    "⇒": "\\ensuremath{\\Rightarrow}",
    "×": "\\ensuremath{\\times}",
    "⋅": "\\ensuremath{\\cdot}",
    "∙": "\\ensuremath{\\cdot}",
    "≤": "\\ensuremath{\\leq}",
    "≥": "\\ensuremath{\\geq}",
}



const texExpansionPattern = (function () {
    const pats: string[] = []
    for (const key of keysOf(texExpansionDefs)) {
        const value = texExpansionDefs[key]!
        pats.push(isString(value) ? key : value.pat)
    }
    return new RegExp(pats.join("|"), "gi")
})()

export function texEscapeChars(text: string): string {
    return text
        .replace(texExpansionPattern, function (matched) {
            const value = texExpansionDefs[matched]!
            return isString(value) ? value : value.repl
        })
}

export function texMathify(text: string): string {
    // sample in:  There is a room with 4 corners
    // sample out: There is a room with $4$ corners
    return text.replace(patterns.texInlineNumbersPattern, "$<pre>$$$<n>$$$<post>")
}

export function texMath(mathText: string): string {
    // replace all no-break spaces with regular spaces, LaTeX will handle them
    return mathText.replace(/[\u202F\u00A0]/g, " ")
}

export const DefaultHtmlWidthPx = 668 // 750 in bebrasmdstlye.css - 2*40 for padding - 2*1 for border

export const DefaultTexWidthPx = 482 // as measured with width of some \includesvg[width=W]{} output

export const HtmlToTexPixelRatio = DefaultTexWidthPx / DefaultHtmlWidthPx


export function parseLanguageCodeFromTaskPath(filepath: string): string | undefined {
    const filename = path.basename(filepath)
    let match
    if (match = patterns.taskFileName.exec(filename)) {
        let langCode
        if (langCode = match.groups.lang_code) {
            if (!isUndefined(codes.languageNameByLanguageCode[langCode])) {
                return langCode
            }
        }
    }
    return undefined
}

export function readFileSyncStrippingBom(filepath: string): string {
    let content = fs.readFileSync(filepath, "utf8")
    if (content.length > 0 && content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1)
        console.log("Warning: file was saved with a UTF-8 BOM, remove it for fewer unexpected results: " + filepath)
    }
    return content
}