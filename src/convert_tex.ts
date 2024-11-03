import fs = require('fs')
import path = require('path')
import _ = require('lodash')
import Token = require('markdown-it/lib/token')
import patterns = require("./patterns")
import { HtmlToTexPixelRatio, TaskMetadata, texEscapeChars, texMath, texMathify } from './util'
import codes = require("./codes")
// import { numberToString } from 'pdf-lib'
import { isString, isUndefined } from 'lodash'
import { parseTask, PluginOptions } from './convert_html'
import { siblingWithExtension, writeData } from './fsutil'
import { getImageSize } from './img_cache'

const DUMP_TOKENS = false

export async function convertTask_tex(taskFile: string, output: string | true, options: Partial<PluginOptions> = {}): Promise<string | true> {

    const [tokens, metadata, langCode] = await parseTask(taskFile, {
        ...options,
        // we use ⍀ to avoid escaping \ to \\, and we later convert it back to true latex blackslash
        customQuotes: ["⍀enquote⦃", "⦄", "⍀enquote⦃", "⦄"],
    })

    const linealizedTokens = _.flatMap(tokens, t => {
        if (t.type === "inline") {
            return t.children ?? []
        } else {
            return [t]
        }
    })

    if (DUMP_TOKENS) {
        for (const t of linealizedTokens) {
            console.log(t)
        }
        console.log(metadata)
    }

    const texDataStandalone = renderTex(linealizedTokens, langCode, metadata, taskFile, true)
    const result = await writeData(texDataStandalone, output, "Standalone TeX")

    if (output !== true) {
        // write the brochure version
        const texDataBrochure = renderTex(linealizedTokens, langCode, metadata, taskFile, false)
        const fileOutBrochure = siblingWithExtension(output, "_brochure.tex")
        await writeData(texDataBrochure, fileOutBrochure, "Brochure TeX")
    }

    return result
}

export function renderTex(linealizedTokens: Token[], langCode: string, metadata: TaskMetadata, taskFile: string, standalone: boolean,): string {

    const year = TaskMetadata.formatYear(metadata)
    const license = patterns.genLicense(metadata)

    const skip = () => ""

    let _currentToken: Token
    let _currentSection: string = "prologue"

    function warn(msg: string) {
        console.log(`Warning: ${msg}`)
        console.log(`  while procesing following token:`)
        console.log(_currentToken)
    }

    type CellType = "thead" | "makecell" | "plain"

    function defaultRendererState() {
        return {
            isInHeading: false,
            isInBold: false,
            currentTable: undefined as undefined | { cellAlignmentChars: Array<string>, closeWith: string },
            currentTableCell: undefined as undefined | { type: CellType, closeWith: string },
            currentTableRowIndex: -1,
            currentTableColumnIndex: -1,
            validMultirows: [] as Array<{ colIndex: number, rowIndex: number, rowspan: number }>,
            lastRowTypeInThisTable: undefined as undefined | "header" | "body",
            hasCellOnThisLine: false,
            closeSectionWith: "",
            disableMathify: false,
            noPageBreak: false,
        }
    }

    type RendererState = ReturnType<typeof defaultRendererState>

    class RendererEnv {
        private stateStack: Array<RendererState>

        constructor() {
            this.stateStack = [defaultRendererState()]
        }

        state(): Readonly<RendererState> {
            return this.stateStack[this.stateStack.length - 1]
        }

        setState(newPartialState: Partial<RendererState>): RendererState {
            const newState = { ...this.state(), ...newPartialState }
            this.stateStack[this.stateStack.length - 1] = newState
            return newState
        }

        pushState(newPartialState: Partial<RendererState>) {
            const newState = { ...this.state(), ...newPartialState }
            this.stateStack.push(newState)
        }

        popState(): RendererState {
            return this.stateStack.pop()!
        }
    }

    type Rules = { [key: string]: undefined | ((tokens: Token[], idx: number, env: RendererEnv) => string | { skipToNext: string }) }

    const sectionCommands: Array<[string, string]> = [
        ["\\section*{\\centering{} ", "}"],
        ["\\subsection*{", "}"],
        ["\\subsubsection*{", "}"],
        ["\\paragraph*{", "}"],
        ["\\subparagraph*{", "}"],
    ]

    const FormatBrochure = true

    const sectionRenderingData: Record<string, { skip: boolean, pre: string, post: string, disableMathify: boolean }> = {
        "Body": { skip: false, pre: "", post: "", disableMathify: false },
        "Question/Challenge": { skip: false, pre: "{\\em\n", post: "}", disableMathify: true },
        "Question/Challenge - for the brochures": { skip: false, pre: "{\\em\n\n", post: "}\n\n", disableMathify: true },
        // "Question/Challenge - for the online challenge": { skip: false, pre: "{\\em\n", post: "}", disableMathify: true },
        "Question/Challenge - for the online challenge": { skip: FormatBrochure, pre: "{\\em\n\n", post: "}\n\n", disableMathify: true },
        "Answer Options/Interactivity Description": { skip: false, pre: "\\begingroup\n\\renewcommand{\\arraystretch}{1.5}", post: "\\endgroup\n", disableMathify: false },
        "Answer Explanation": { skip: false, pre: "", post: "", disableMathify: false },
        "It's Informatics": { skip: false, pre: "", post: "", disableMathify: false },
        "Keywords and Websites": { skip: false, pre: "{\\raggedright\n", post: "\n}", disableMathify: true },
        "Wording and Phrases": { skip: FormatBrochure, pre: "", post: "", disableMathify: true },
        "Comments": { skip: FormatBrochure, pre: "", post: "", disableMathify: true },
        "Contributors": { skip: FormatBrochure, pre: "", post: "", disableMathify: true },
        "Support Files": { skip: FormatBrochure, pre: "", post: "", disableMathify: true },
        "License": { skip: FormatBrochure, pre: "", post: "", disableMathify: true },
    }

    const skipHeader = FormatBrochure

    function sectionCommandsForHeadingToken(t: Token): [string, string] {
        const level = parseInt(t.tag.slice(1))
        const idx = Math.min(level - 1, sectionCommands.length - 1)
        return sectionCommands[idx]
    }


    const expand: Rules = {

        "header": (tokens, idx, env) => {
            if (skipHeader) {
                return ""
            }

            const ageCategories = patterns.ageCategories
            const firstLevelCategories = patterns.categories.map(c => c.name)

            const ageCatTitles = (Object.keys(ageCategories) as Array<keyof typeof ageCategories>)
            const ageCatTitleCells = ageCatTitles.map(c => `\\textit{${c}:}`).join(" & ")

            const ageCatValueCells = ageCatTitles.map(c => {
                const catFieldName = ageCategories[c]
                const catValue: string = metadata.ages[catFieldName] || "--"
                return catValue
            }).join(" & ")

            const numCat1 = Math.floor(firstLevelCategories.length / 2)

            const checkedBox = `$\\boxtimes$`
            const uncheckedBox = `$\\square$`

            function catToRow(catName: string) {
                const isRelated = !!metadata.categories.find(c => c.name === catName)
                const catChecked = isRelated ? checkedBox : uncheckedBox
                return `${catChecked} ${texEscapeChars(catName)}`
            }

            let catCell1 = `\\textit{Categories:}`
            for (let i = 0; i < numCat1; i++) {
                catCell1 += `\\newline ${catToRow(firstLevelCategories[i])}`
            }

            let catCell2 = ``
            for (let i = numCat1; i < firstLevelCategories.length; i++) {
                if (i !== numCat1) {
                    catCell2 += "\\newline "

                }
                catCell2 += catToRow(firstLevelCategories[i])
            }

            // TODO CTSKILLS

            const keywordsCaption = `\\textit{Keywords: }`
            const keywords = metadata.keywords.map(kwLine => {
                const match = patterns.keyword.exec(kwLine)
                return match ? match.groups.keyword : kwLine
            })
            const keywordsStr = keywords.length === 0 ? "—" : keywords.map(texEscapeChars).join(", ")

            function multicolumn(n: number, contents: string): string {
                const spec = `{|>{\\hsize=\\dimexpr${n}\\hsize+${n + 1}\\tabcolsep+${n - 1}\\arrayrulewidth\\relax}X|}`
                return `\\multicolumn{${n}}${spec}{${contents}}`
            }

            return `
\\renewcommand{\\tabularxcolumn}[1]{>{}p{#1}}
{\\footnotesize\\begin{tabularx}{\\columnwidth}{ | *{6}{ >{\\centering\\arraybackslash}X | } }
  \\hline
  ${ageCatTitleCells} \\\\
  ${ageCatValueCells} \\\\
  \\hline
  ${multicolumn(6, `\\textit{Answer Type:} ${texEscapeChars(metadata.answer_type)}`)} \\\\
  \\hline
  ${multicolumn(3, catCell1)} &  ${multicolumn(3, catCell2)} \\\\
  \\hline
  ${multicolumn(6, `\\settowidth{\\hangindent}{${keywordsCaption}}${keywordsCaption}${keywordsStr}`)} \\\\
  \\hline
\\end{tabularx}}
\\renewcommand{\\tabularxcolumn}[1]{>{}m{#1}}\n`
        },


        "license_body": (tokens, idx, env) => {
            // https://tex.stackexchange.com/questions/5433/can-i-use-an-image-located-on-the-web-in-a-latex-document
            const licenseLogoPath = path.join(__dirname, "..", "static", "CC_by-sa.pdf")
            return `
 \\renewcommand{\\tabularxcolumn}[1]{>{}m{#1}}
 {\\begin{tabularx}{\\columnwidth}{ l X }
 \\makecell[c]{\\includegraphics{${licenseLogoPath}}} & \\scriptsize ${license.fullCopyright()} \\href{${license.url}}{${license.url}}
\\end{tabularx}}
\\renewcommand{\\tabularxcolumn}[1]{>{}m{#1}}\n`
        },

    }

    function roundTenth(x: number): number {
        return Math.round(x * 10) / 10
    }

    function closeLineIfNeeded(env: RendererEnv) {
        env.setState({ currentTableColumnIndex: -1 })
        const lastRowType = env.state().lastRowTypeInThisTable
        if (lastRowType) {
            env.setState({ lastRowTypeInThisTable: undefined })
            const lineIfNeeded = (lastRowType === "header") ? "\\midrule\n" : "" // \topstrut doesn't work if followed by \muticolumn...
            return ` \\\\ \n${lineIfNeeded}`
        }
        return ""
    }

    function nonExpandingAlignment(possiblyExpandingAlignment?: string): string {
        if (possiblyExpandingAlignment === "J") {
            return "l"
        } else if (isUndefined(possiblyExpandingAlignment)) {
            return "l"
        } else {
            return possiblyExpandingAlignment.toLowerCase()
        }
    }

    function openCellPushingState(type: CellType, token: Token, env: RendererEnv): string {
        let state = env.setState({ currentTableColumnIndex: env.state().currentTableColumnIndex + 1 })
        let colIndex = state.currentTableColumnIndex
        const rowIndex = state.currentTableRowIndex

        let sep = ""
        if (state.hasCellOnThisLine) {
            env.setState({ hasCellOnThisLine: false })
            sep = " & "
        }

        function isSpannedByMultirow(): boolean {
            for (const multirow of state.validMultirows) {
                if (colIndex === multirow.colIndex && rowIndex <= multirow.rowIndex + multirow.rowspan - 1) {
                    return true
                }
            }
            return false
        }
        while (isSpannedByMultirow()) {
            // add a blank cell
            sep += "& "
            colIndex++
            state = env.setState({ currentTableColumnIndex: colIndex })
        }

        const align = nonExpandingAlignment(state.currentTable?.cellAlignmentChars[colIndex])

        let disableMathify = false
        let isInBold = false
        let open = "" // default open and close markup
        let close = ""
        if (type === "thead") {
            // second char 'b' means 'bottom vertical alignement', which
            // we should have for headers
            open = `{\\setstretch{1.0}\\thead[${align}b]{`
            close = `}}`
            disableMathify = true
            isInBold = true
        } else if (type === "makecell") {
            open = `\\makecell[${align}]{`
            close = `}`
        }

        const rowspanStr = token.attrGet("rowspan")
        let rowspan
        if (rowspanStr && (rowspan = parseInt(rowspanStr)) >= 2) {
            // multirow
            open = `\\multirow{${rowspan}}{*}{` + open
            close = close + `}`
            state.validMultirows.push({ colIndex, rowIndex, rowspan })
        }

        const colspanStr = token.attrGet("colspan")
        let colspan
        if (colspanStr && (colspan = parseInt(colspanStr)) >= 2) {
            // multicolumn
            open = `\\multicolumn{${colspan}}{${align}}{` + open
            close = close + `}`
        }

        env.pushState({ currentTableCell: { type, closeWith: close }, disableMathify, isInBold })
        const debug = ""
        // const debug = `(${rowIndex},${colIndex})--`
        return sep + open + debug
    }

    function closeCellPoppingState(env: RendererEnv): string {
        const cellState = env.popState()
        env.setState({ hasCellOnThisLine: true })
        return cellState.currentTableCell?.closeWith ?? ""
    }

    function breakIfInTableCell(env: RendererEnv): string | undefined {
        const currentTableCell = env.state().currentTableCell
        if (currentTableCell) {
            if (currentTableCell.type === "plain") {
                return " \\newline "
            } else {
                return " \\\\ "
            }
        }
        return undefined
    }

    function isSurrounded(tokens: Array<Token>, idx: number, distance: number, item: string, itemClose?: string): boolean {
        let itemOpen
        if (isUndefined(itemClose)) {
            itemOpen = `${item}_open`
            itemClose = `${item}_close`
        } else {
            itemOpen = item
        }
        const surrounded = idx - distance >= 0 &&
            idx + distance < tokens.length &&
            tokens[idx - distance].type === itemOpen &&
            tokens[idx + distance].type === itemClose
        return surrounded
    }

    const rules: Rules = {

        "inline": (tokens, idx, env) => {
            warn("unexpected inline tokens, should have been lineralized")
            return ""
        },

        "bebras_html_expand": (tokens, idx, env) => {
            const t = tokens[idx]
            const rule = expand[t.meta]
            if (rule) {
                return rule(tokens, idx, env)
            } else {
                warn(`no rule to expand '${t.meta}'`)
                return ""
            }
        },

        "text": (tokens, idx, env) => {
            let text = tokens[idx].content
            text = texEscapeChars(text)
            const state = env.state()
            if (!state.isInHeading && !state.disableMathify) {
                text = texMathify(text)
            }
            return text
        },

        "code_inline": (tokens, idx, env) => {
            const content = texEscapeChars(tokens[idx].content)
            return `\\BrochureInlineCode{${content}}`
        },

        "code_block": (tokens, idx, env) => {
            const content = texEscapeChars(tokens[idx].content)
            return `\\begin{BrochureCode}\n${content}\\end{BrochureCode}\n\n`
        },

        "math_inline_double": (tokens, idx, env) => {
            return `$${tokens[idx].content}$`
        },

        "image": (tokens, idx, env) => {
            const t = tokens[idx]

            const imgPathForHtml = t.attrGet("src")!
            let type = "graphics"
            if (imgPathForHtml.endsWith(".svg")) {
                type = "svg"
            }

            const imgPathIsAbsolute = imgPathForHtml.startsWith("/")
            const imgPath = imgPathIsAbsolute ? imgPathForHtml : "\\taskGraphicsFolder/" + imgPathForHtml

            let title = t.attrGet("title")
            let includeOpts = ""
            let placement = "unspecified"
            let placementArgs = undefined as string | undefined
            let widthStr: string | undefined = undefined
            let scale: number | undefined = undefined
            let match, value
            if (title && (match = patterns.imageOptions.exec(title))) {
                title = title.replace(patterns.imageOptions, "")
                if (value = match.groups.width_abs) {
                    const f = roundTenth(parseFloat(value) * HtmlToTexPixelRatio)
                    widthStr = `${f}px`
                    includeOpts = `[width=${widthStr}]`
                } else if (value = match.groups.width_rel) {
                    const f = roundTenth(parseFloat(value.slice(0, value.length - 1)) / 100)
                    widthStr = `${f}\\linewidth`
                    includeOpts = `[width=${widthStr}]`
                }
                if (value = match.groups.placement) {
                    placement = value
                }
                if (value = match.groups.placement_args) {
                    placementArgs = value
                }
            }

            if (includeOpts.length === 0 && (value = metadata.settings?.default_image_scale)) {
                scale = value
                includeOpts = `[scale=${value}]`
            }

            const state = env.state()
            const includeCmd = `\\include${type}${includeOpts}{${imgPath}}`

            let before = ""
            let after = ""

            function useMakecell() {
                const colIndex = state.currentTableColumnIndex
                const align = nonExpandingAlignment(state.currentTable?.cellAlignmentChars[colIndex])
                before = `\\makecell[${align}]{`
                after = `}`
            }

            function useCenterEnv() {
                // before = `{\\centering%\\begin{center}\n`
                // after = `\n\\end{center}`
                before = `{\\centering%\n`
                after = `\\par}`
            }

            function useRaisebox(ignoreHeight: boolean, vAdjust?: string) {
                const baseOffset = "-0.5ex"
                const raiseboxParam = isUndefined(vAdjust)
                    ? baseOffset
                    : `\\dimexpr ${baseOffset} ${vAdjust} \\relax`
                const sizeopt = ignoreHeight ? "[0pt][0pt]" : ""
                before = `\\raisebox{${raiseboxParam}}${sizeopt}{`
                after = `}`
            }

            const isInTable = !!state.currentTableCell
            // console.log({ imgPath, placement, placementArgs })
            if (placement === "unspecified" || placement === "inline" || isInTable) {
                const elemsConsideredSurroundingText = ["text", "paragraph_open", "paragraph_close", "image", "softbreak"]
                if (isSurrounded(tokens, idx, 1, "paragraph")) {
                    if (isSurrounded(tokens, idx, 2, "td")) {
                        // console.log("use makecell1")
                        useMakecell()
                    } else if (!isInTable) {
                        // console.log("use center env")
                        useCenterEnv()
                    } else {
                        // inline in table cell
                        // console.log("use raisebox1")
                        useRaisebox(false, placementArgs)
                    }
                } else if (isSurrounded(tokens, idx, 1, "td")) {
                    // console.log("use makecell2")
                    useMakecell()
                } else if (
                    (idx > 0 && elemsConsideredSurroundingText.includes(tokens[idx - 1].type))
                    || idx < tokens.length - 1 && elemsConsideredSurroundingText.includes(tokens[idx + 1].type)
                ) {
                    // inline in paragraph
                    let ignoreHeight = true
                    let referenceWidth
                    try {
                        // heuristic: if width is >= 30, then don't ignore
                        const indicatedWidthOr0 = parseInt(widthStr?.replace(/px/, "") ?? "0")
                        if (indicatedWidthOr0 !== 0) {
                            referenceWidth = indicatedWidthOr0
                        } else {
                            const realImgPath = path.join(path.dirname(taskFile), imgPathForHtml)
                            referenceWidth = (scale ?? 1) * getImageSize(realImgPath)
                        }
                        ignoreHeight = referenceWidth < 30
                    } catch { }
                    // console.log("use raisebox2, ignoreHeight=" + ignoreHeight + ", referenceWidth=" + referenceWidth)
                    useRaisebox(ignoreHeight, placementArgs)
                } else {
                    // console.log("use raw")
                    // console.log(tokens.slice(idx - 5, idx + 5))
                }

            } else {
                // left or right
                const placementSpec = placement[0].toUpperCase()
                if (!widthStr && !isUndefined(scale)) {
                    // read teh image wto know its width
                    const realImgPath = path.join(path.dirname(taskFile), imgPathForHtml)
                    const imgSize = getImageSize(realImgPath)
                    widthStr = (scale * imgSize) + "px"
                }

                if (widthStr) {
                    before = `\\begin{wrapfigure}{${placementSpec}}{${widthStr}}\n\\raisebox{-.46cm}[\\dimexpr \\height-.92cm \\relax][-.46cm]{`
                    after = `}\n\\end{wrapfigure}`
                } else {
                    warn(`Undefined width for floating image '${imgPathForHtml}'`)
                }
            }

            return `${before}${includeCmd}${after}`
        },

        "raw": (tokens, idx, env) => {
            const t = tokens[idx]
            if (t.info === "tex") {
                return t.content
            } else {
                return ""
            }
        },


        "math_inline": (tokens, idx, env) => {
            // enclosing with { } preserves fix spacing
            return '${' + texMath(tokens[idx].content) + '}$'
        },

        "math_single": (tokens, idx, env) => {
            return '$' + tokens[idx].content + '$'
        },

        "math_block": (tokens, idx, env) => {
            return '$$' + texMath(tokens[idx].content) + '$$\n\n'
        },

        "math_block_eqno": (tokens, idx, env) => {
            return '$$' + texMath(tokens[idx].content) + '$$\n\n' // TODO add eqno?
        },

        "math_block_end": skip,

        "hardbreak": (tokens, idx, env) => {
            let value
            if (value = breakIfInTableCell(env)) {
                return value
            }
            return " \\\\\n"
        },

        "softbreak": (tokens, idx, env) => {
            let value
            if (value = breakIfInTableCell(env)) {
                return value
            }
            return "\n"
        },

        "heading_open": (tokens, idx, env) => {
            const cmd = sectionCommandsForHeadingToken(tokens[idx])[0]
            env.pushState({ isInHeading: true })
            return `\n${cmd}`
        },

        "heading_close": (tokens, idx, env) => {
            const cmd = sectionCommandsForHeadingToken(tokens[idx])[1]
            env.popState()
            return `${cmd}\n\n`
        },


        "paragraph_open": skip,

        "paragraph_close": (tokens, idx, env) => {
            const state = env.state()
            let type
            if (state.currentTableCell) {
                // ignore
                return ""
            } else if (idx + 1 < tokens.length && (type = tokens[idx + 1].type).endsWith("_close") && type !== "secbody_close") {
                // ignore, too... // TODO have a system that ensures a certain number of max newlines?
                return ""
            } else if (state.noPageBreak) {
                return "\n\n\\nopagebreak\n\n"
            } else {
                return "\n\n"
            }
        },


        "bullet_list_open": (tokens, idx, env) => {
            return `\\begin{itemize}\n`
        },

        "bullet_list_close": (tokens, idx, env) => {
            // no \n prefix as list_item_close has already inserted it
            return "\\end{itemize}\n\n"
        },


        "ordered_list_open": (tokens, idx, env) => {
            const start = tokens[idx].attrGet("start")
            const startTex = start === null ? "" : `  \\setcounter{enumi}{${parseInt(start) - 1}}\n`
            return `\\begin{enumerate}\n${startTex}`
        },

        "ordered_list_close": (tokens, idx, env) => {
            // no \n prefix as list_item_close has already inserted it
            return "\\end{enumerate}\n\n"
        },


        "list_item_open": (tokens, idx, env) => {
            return `  \\item `
        },

        "list_item_close": (tokens, idx, env) => {
            return "\n"
        },


        "em_open": (tokens, idx, env) => {
            return `\\emph{`
        },

        "em_close": (tokens, idx, env) => {
            return `}`
        },


        "strong_open": (tokens, idx, env) => {
            const alreadyBold = env.state().isInBold
            env.pushState({ disableMathify: true, isInBold: !alreadyBold })
            return alreadyBold ? `\\textnormal{` : `\\textbf{`
        },

        "strong_close": (tokens, idx, env) => {
            env.popState()
            return `}`
        },


        "sup_open": (tokens, idx, env) => {
            return `\\textsuperscript{`
        },

        "sup_close": (tokens, idx, env) => {
            return `}`
        },


        "sub_open": (tokens, idx, env) => {
            return `\\textsubscript{`
        },

        "sub_close": (tokens, idx, env) => {
            return `}`
        },


        "link_open": (tokens, idx, env) => {
            const t = tokens[idx]
            return `\\href{${t.attrGet("href")!.replace(/%/g, "\\%").replace(/#/g, "\\#")}}{\\BrochureUrlText{`
        },

        "link_close": (tokens, idx, env) => {
            return `}}`
        },


        "table_open": (tokens, idx, env) => {
            const t = tokens[idx]

            interface TableMetaSep {
                aligns: Array<string>
                valigns: Array<string>
                wraps: Array<boolean>
                map: [number, number]
            }
            interface TableMeta {
                sep: TableMetaSep
                cap: null | object
                tr: Array<Token>
            }

            function columnSpec(alignString: string, hresize: boolean): string {
                switch (alignString) {
                    case "":
                        // default is justified
                        return hresize ? "J" : "l"
                    case "left":
                        return hresize ? "L" : "l"
                    case "center":
                        return hresize ? "C" : "c"
                    case "right":
                        return hresize ? "R" : "r"
                    default:
                        warn(`Unknown table column alignment: '${alignString}'`)
                        return "l"
                }
            }

            const tableMeta: TableMeta = t.meta
            const ncols = tableMeta.sep.aligns.length
            const specs: Array<string> = []
            let hasAnyHResize = false
            for (let i = 0; i < ncols; i++) {
                const hresize = tableMeta.sep.wraps[i]
                if (hresize) {
                    hasAnyHResize = true
                }
                specs.push(columnSpec(tableMeta.sep.aligns[i], hresize))
            }

            const spec = "@{} " + specs.join(" ") + " @{}"
            const open = !hasAnyHResize ? `\\begin{tabular}{ ${spec} }\n` : `\\begin{tabularx}{\\columnwidth}{ ${spec} }\n`
            const close = !hasAnyHResize ? `\n\\end{tabular}\n\n` : `\n\\end{tabularx}\n\n`

            env.pushState({ currentTableRowIndex: -1, validMultirows: [], currentTable: { cellAlignmentChars: specs, closeWith: close } })

            return open
        },

        "table_close": (tokens, idx, env) => {
            const state = env.popState()
            return state.currentTable!.closeWith
        },

        "thead_open": skip,
        "thead_close": skip,
        "tbody_open": skip,
        "tbody_close": skip,


        "tr_open": (tokens, idx, env) => {
            const closeIfNeeded = closeLineIfNeeded(env)
            env.setState({ currentTableRowIndex: env.state().currentTableRowIndex + 1 })
            return closeIfNeeded + "  "
        },

        "tr_close": (tokens, idx, env) => {
            const lastRowInThisTable = (tokens[idx - 1].type === "th_close") ? "header" : "body"
            env.setState({ hasCellOnThisLine: false, lastRowTypeInThisTable: lastRowInThisTable })
            return ""
        },

        "th_open": (tokens, idx, env) => {
            return openCellPushingState("thead", tokens[idx], env)
        },

        "th_close": (tokens, idx, env) => {
            return closeCellPoppingState(env)
        },

        "td_open": (tokens, idx, env) => {
            let hasBreaks = false
            const itemsPreventingMakecell = ["table_open", "ordered_list_open", "bullet_list_open"]
            let hasItemPreventingMakecell = false
            for (let i = idx + 1; i < tokens.length; i++) {
                const type = tokens[i].type
                if (type === "td_close") {
                    break
                } else if (type === "softbreak" || type === "hardbreak") {
                    hasBreaks = true
                } else if (itemsPreventingMakecell.includes(type)) {
                    hasItemPreventingMakecell = true
                }
            }
            const cellType = (hasBreaks && !hasItemPreventingMakecell) ? "makecell" : "plain"
            return openCellPushingState(cellType, tokens[idx], env)
        },

        "td_close": (tokens, idx, env) => {
            return closeCellPoppingState(env)
        },


        "container_center_open": (tokens, idx, env) => {
            return `{\\centering%\n`
            // return `\\begin{center}\n`
        },

        "container_center_close": (tokens, idx, env) => {
            return `\\par}\n\n`
            // return `\n\\end{center}\n\n`
        },


        "container_clear_open": (tokens, idx, env) => {
            return `` // TODO: try to clear all figures
        },

        "container_clear_close": (tokens, idx, env) => {
            return ``
        },


        "container_indent_open": (tokens, idx, env) => {
            return `\\begin{adjustwidth}{1.5em}{0em}\n`
        },

        "container_indent_close": (tokens, idx, env) => {
            return `\n\\end{adjustwidth}\n\n`
        },


        "container_nobreak_open": (tokens, idx, env) => {
            env.pushState({ noPageBreak: true })
            return `\\begin{samepage}\n`
        },

        "container_nobreak_close": (tokens, idx, env) => {
            env.popState()
            return `\n\\end{samepage}\n\n`
        },


        "container_fullwidth_open": (tokens, idx, env) => {
            return `\\resizebox{\\textwidth}{!}{%\n`
        },

        "container_fullwidth_close": (tokens, idx, env) => {
            return `\n}\n\n`
        },


        "seccontainer_open": (tokens, idx, env) => {
            let secData = { skip: false, pre: "", post: "", disableMathify: false }

            const sectionName = tokens[idx].info
            const specificSecData = sectionRenderingData[sectionName]
            if (specificSecData) {
                secData = specificSecData
            }
            if (secData.skip) {
                return { skipToNext: "seccontainer_close" }
            } else {
                env.pushState({ closeSectionWith: secData.post, disableMathify: secData.disableMathify })
                return secData.pre
            }
        },

        "seccontainer_close": (tokens, idx, env) => {
            const state = env.popState()
            return state.closeSectionWith
        },

        "secbody_open": (tokens, idx, env) => {
            const sectionName = tokens[idx].info
            _currentSection = sectionName
            return ""
        },

        "secbody_close": (tokens, idx, env) => {
            _currentSection = "intersection_text"
            return ""
        },

        "main_open": skip,
        "main_close": skip,

        "tocOpen": skip,
        "tocBody": skip,
        "tocClose": skip,

        "container_comment_open": () => {
            return { skipToNext: "container_comment_close" }
        },
        "container_comment_close": skip,

    }

    const sectionStrs: Record<string, Array<string>> = {}


    function traverse(tokens: Token[], env: RendererEnv): string {
        const parts = [] as string[]
        let r

        for (let idx = 0; idx < tokens.length; idx++) {
            _currentToken = tokens[idx]
            const rule = rules[_currentToken.type]
            if (rule) {
                if (r = rule(tokens, idx, env)) {
                    if (isString(r)) {
                        parts.push(r)
                        let secParts = sectionStrs[_currentSection]
                        if (isUndefined(secParts)) {
                            secParts = [r]
                            sectionStrs[_currentSection] = secParts
                        } else {
                            secParts.push(r)
                        }
                    } else {
                        const { skipToNext } = r
                        while (tokens[idx].type !== skipToNext) {
                            idx++
                            if (idx === tokens.length) {
                                break
                            }
                        }
                    }
                }
            } else {
                warn(`No renderer rule for ${_currentToken.type}`)
            }
        }
        return parts.join("")
    }

    const env = new RendererEnv()
    const taskTex = traverse(linealizedTokens, env)

    const babels: Record<string, string> = {
        eng: `\\usepackage[english]{babel}`,
        deu: `\\usepackage[german]{babel}`,
        ita: `\\usepackage[italian]{babel}`,
        fra: `\\usepackage[french]{babel}
\\frenchbsetup{ThinColonSpace=true}
\\renewcommand*{\\FBguillspace}{\\hskip .4\\fontdimen2\\font plus .1\\fontdimen3\\font minus .3\\fontdimen4\\font \\relax}`,
    }

    const babel = babels[langCode] ?? babels.eng


    function difficultyIndex(ageCat: "6-8" | "8-10" | "10-12" | "12-14" | "14-16" | "16-19"): number {
        const diffStr = metadata.ages[ageCat]
        if (diffStr.startsWith("--")) {
            return 0
        }
        if (diffStr === "easy") {
            return 1
        }
        if (diffStr === "medium") {
            return 2
        }
        if (diffStr === "hard") {
            return 3
        }
        if (diffStr === "bonus") {
            return 4
        }
        return 0
    }

    let countryCode = "??"
    let match
    if (match = patterns.idWithOtherYear.exec(metadata.id)) {
        countryCode = match.groups.country_code
    }

    function asciify(name: string): string {
        // https://stackoverflow.com/questions/990904/remove-accents-diacritics-in-a-string-in-javascript
        return name
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/ł/g, "l")
            .replace(/[\-]/g, "")
    }

    function normalizeAuthorName(fullName: string): string[] {
        const parts = fullName.split(/ +/)
        if (parts.length === 1) {
            console.log(`WARNING: Cannot split full name '${fullName}'`)
            return [asciify(parts[0]), "A"]
        } else {
            if (year === 'latest' || year <= 2023) {
                // just one letter for first name
                if (parts.length === 2) {
                    return [asciify(parts[1]), asciify(parts[0][0]).toUpperCase()]
                } else {
                    const split: [string, string] = [asciify(parts[parts.length - 1]), asciify(parts[0][0]).toUpperCase()]
                    // console.log(`WARNING: Check split for full name '${fullName}': ${split}`)
                    return split
                }
            } else {
                // complete first name
                const normalizedParts = []
                for (let i = parts.length - 1; i >= 0; i--) {
                    const asciified = asciify(parts[i]).replace(/\./g, "")
                    normalizedParts.push(asciified[0].toUpperCase() + asciified.slice(1))
                }
                return normalizedParts
            }
        }
    }

    function authorDefs(): string {
        const authorLines: Array<string> = []
        metadata.contributors.forEach((contribLine) => {
            const match = patterns.contributor.exec(contribLine)
            if (match) {
                const name = match.groups.name
                const nameParts = normalizeAuthorName(name)
                const authorCmd = "\\Author" + nameParts.join("")
                const lowercaseCountryCode = codes.countryCodeByCountryName[match.groups.country]?.toLowerCase() ?? "aa"
                if (lowercaseCountryCode === "aa") {
                    console.log(`WARNING: unrecognized country '${match.groups.country}'`)
                }
                const texifiedName = name.replace(/\. /g, ".~")
                const define = `\\ifdefined${authorCmd} \\BrochureFlag{${lowercaseCountryCode}}{} ${texifiedName}\\fi`
                const marker = `\\def${authorCmd}{}`
                authorLines.push(`${marker} % ${define}`)
            }
        })
        return authorLines.join("\n")
    }

    function sectionTexFor(secName: string, fallbackSecName?: string): string {

        function defaultContents() {
            console.log(`WARNING: No content for section '${secName}'` + (isUndefined(fallbackSecName) ? "" : ` (fallback name: '${fallbackSecName}')`))
            console.log(Object.keys(sectionStrs))
            return ["TODO"]
        }

        sectionStrs

        return (
            sectionStrs[secName]
            ?? (isUndefined(fallbackSecName) ? undefined : sectionStrs[fallbackSecName])
            ?? defaultContents()
        ).join("")
    }

    const isInteractiveTask = metadata.answer_type.toLowerCase().includes("interact")

    if (!standalone) {
        return `% Definition of the meta information: task difficulties, task ID, task title, task country; definition of the variables as well as their scope is in commands.tex
\\setcounter{taskAgeDifficulty3to4}{${difficultyIndex("8-10")}}
\\setcounter{taskAgeDifficulty5to6}{${difficultyIndex("10-12")}}
\\setcounter{taskAgeDifficulty7to8}{${difficultyIndex("12-14")}}
\\setcounter{taskAgeDifficulty9to10}{${difficultyIndex("14-16")}}
\\setcounter{taskAgeDifficulty11to13}{${difficultyIndex("16-19")}}
\\renewcommand{\\taskTitle}{${metadata.title}}
\\renewcommand{\\taskCountry}{${countryCode}}

% include this task only if for the age groups being processed this task is relevant
\\ifthenelse{
  \\(\\boolean{age3to4} \\AND \\(\\value{taskAgeDifficulty3to4} > 0\\)\\) \\OR
  \\(\\boolean{age5to6} \\AND \\(\\value{taskAgeDifficulty5to6} > 0\\)\\) \\OR
  \\(\\boolean{age7to8} \\AND \\(\\value{taskAgeDifficulty7to8} > 0\\)\\) \\OR
  \\(\\boolean{age9to10} \\AND \\(\\value{taskAgeDifficulty9to10} > 0\\)\\) \\OR
  \\(\\boolean{age11to13} \\AND \\(\\value{taskAgeDifficulty11to13} > 0\\)\\)}{

\\newchapter{\\taskTitle}

% task body
${sectionTexFor("Body")}

% question (as \\emph{})
{\\em
${sectionTexFor("Question/Challenge", "Question/Challenge - for the brochures")}
}

% answer alternatives (as \\begin{enumerate}[A)]) or interactivity
${isInteractiveTask ? '' : sectionTexFor("Answer Options/Interactivity Description")}

% from here on this is only included if solutions are processed
\\ifthenelse{\\boolean{solutions}}{
\\newpage

% answer explanation
\\section*{\\BrochureSolution}
${sectionTexFor("Answer Explanation")}

% it's informatics
\\section*{\\BrochureItsInformatics}
${sectionTexFor("It's Informatics", "This is Informatics")}

% keywords and websites (as \\begin{itemize})
\\section*{\\BrochureWebsitesAndKeywords}
{\\raggedright
${sectionTexFor("Keywords and Websites", "Informatics Keywords and Websites")}
}

% end of ifthen for excluding the solutions
}{}

% all authors
% Note: there has to be a corresponding entry is in ../main/authors.tex.
${authorDefs()}

\\newpage}{}
`
    } else {
        return '' +
            `\\documentclass[a4paper,11pt]{report}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}

${babel}
\\AtBeginDocument{\\def\\labelitemi{$\\bullet$}}

\\usepackage{etoolbox}

\\usepackage[margin=2cm]{geometry}
\\usepackage{changepage}
\\makeatletter
\\renewenvironment{adjustwidth}[2]{%
    \\begin{list}{}{%
    \\partopsep\\z@%
    \\topsep\\z@%
    \\listparindent\\parindent%
    \\parsep\\parskip%
    \\@ifmtarg{#1}{\\setlength{\\leftmargin}{\\z@}}%
                 {\\setlength{\\leftmargin}{#1}}%
    \\@ifmtarg{#2}{\\setlength{\\rightmargin}{\\z@}}%
                 {\\setlength{\\rightmargin}{#2}}%
    }
    \\item[]}{\\end{list}}
\\makeatother

\\newcommand{\\BrochureUrlText}[1]{\\texttt{#1}}
\\usepackage{setspace}
\\setstretch{1.15}

\\usepackage{tabularx}
\\usepackage{booktabs}
\\usepackage{makecell}
\\usepackage{multirow}
\\renewcommand\\theadfont{\\bfseries}
\\renewcommand{\\tabularxcolumn}[1]{>{}m{#1}}
\\newcolumntype{R}{>{\\raggedleft\\arraybackslash}X}
\\newcolumntype{C}{>{\\centering\\arraybackslash}X}
\\newcolumntype{L}{>{\\raggedright\\arraybackslash}X}
\\newcolumntype{J}{>{\\arraybackslash}X}

\\usepackage{listings}
\\lstnewenvironment{BrochureCode}{%
  \\lstset{
      basicstyle=\\ttfamily,
      aboveskip=\\parskip,
      belowskip=\\parskip,
      columns=flexible
  }}{}
\\newcommand{\\BrochureInlineCode}[1]{{\\ttfamily #1}}

\\usepackage{amssymb}
\\usepackage{amsmath}

\\usepackage[babel=true,maxlevel=3]{csquotes}
\\DeclareQuoteStyle{bebras-ch-eng}{“}[” ]{”}{‘}[”’ ]{’}\
\\DeclareQuoteStyle{bebras-ch-deu}{«}[» ]{»}{“}[»› ]{”}
\\DeclareQuoteStyle{bebras-ch-fra}{«\\thinspace{}}[» ]{\\thinspace{}»}{“}[»\\thinspace{}› ]{”}
\\DeclareQuoteStyle{bebras-ch-ita}{«}[» ]{»}{“}[»› ]{”}
\\setquotestyle{bebras-ch-${langCode}}

\\usepackage{hyperref}
\\usepackage{graphicx}
\\usepackage{svg}
\\svgsetup{inkscapeversion=1,inkscapearea=page}
\\usepackage{wrapfig}

\\usepackage{enumitem}
\\setlist{nosep,itemsep=.5ex}

\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{2ex}
\\raggedbottom

\\usepackage{fancyhdr}
\\usepackage{lastpage}
\\pagestyle{fancy}

\\fancyhf{}
\\renewcommand{\\headrulewidth}{0pt}
\\renewcommand{\\footrulewidth}{0.4pt}
\\lfoot{\\scriptsize ${texEscapeChars(license.shortCopyright())}}
\\cfoot{\\scriptsize\\itshape ${texEscapeChars(metadata.id)} ${texEscapeChars(metadata.title)}}
\\rfoot{\\scriptsize Page~\\thepage{}/\\pageref*{LastPage}}

\\newcommand{\\taskGraphicsFolder}{..}

\\begin{document}
${taskTex}
\\end{document}
`

    }
}
