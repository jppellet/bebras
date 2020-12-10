import fs = require('fs')
import path = require('path')
import md2html = require('./md2html')
import _ = require('lodash')
import Token = require('markdown-it/lib/token')
import patterns = require("./patterns")
import { texMathify, HtmlToTexPixelRatio, Dict, texEscapeChars, parseLanguageCodeFromTaskPath, readFileSyncStrippingBom, texMath } from './util'
import codes = require("./codes")
import { numberToString } from 'pdf-lib'
import { stringify } from 'querystring'
import { SectionAssociatedData } from './patterns'
import { isString } from 'lodash'

export function runTerminal(fileIn: string, fileOut: string) {
    const texData = renderTex(fileIn)
    fs.writeFileSync(fileOut, texData)
    console.log(`Output written on ${fileOut}`)
}

export function renderTex(filepath: string): string {

    const langCode = parseLanguageCodeFromTaskPath(filepath) ?? codes.defaultLanguageCode()

    const textMd = readFileSyncStrippingBom(filepath)

    const [tokens, metadata] = md2html.parseMarkdown(textMd, {
        langCode,
        // we use ⍀ to avoid escaping \ to \\, and we later convert it back to \
        customQuotes: ["⍀enquote⦃", "⦄", "⍀enquote⦃", "⦄"],
    })


    const linealizedTokens = _.flatMap(tokens, t => {
        if (t.type === "inline") {
            return t.children ?? []
        } else {
            return [t]
        }
    })

    // for (const t of linealizedTokens) {
    //     console.log(t)
    // }
    // console.log(metadata)

    const license = patterns.genLicense(metadata)

    const skip = () => ""

    let _currentToken: Token

    function warn(msg: string) {
        console.log(`Warning: ${msg}`)
        console.log(`  while procesing following token:`)
        console.log(_currentToken)
    }

    type CellType = "thead" | "makecell" | "plain"

    function defaultRendererState() {
        return {
            isInHeading: false,
            currentTableCell: undefined as undefined | { type: CellType, closeWith: string },
            currentTableRowIndex: -1,
            currentTableColumnIndex: -1,
            validMultirows: [] as Array<{ colIndex: number, rowIndex: number, rowspan: number }>,
            lastRowTypeInThisTable: undefined as undefined | "header" | "body",
            hasCellOnThisLine: false,
            closeSectionWith: "",
            disableMathify: false,
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

    const sectionRenderingData: Dict<{ skip: boolean, pre: string, post: string, disableMathify: boolean }> = {
        "Body": { skip: false, pre: "", post: "", disableMathify: false },
        "Question/Challenge": { skip: false, pre: "{\\em", post: "}", disableMathify: true },
        "Answer Options/Interactivity Description": { skip: false, pre: "", post: "", disableMathify: false },
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
            const categories = patterns.categories

            const ageCatTitles = (Object.keys(ageCategories) as Array<keyof typeof ageCategories>)
            const ageCatTitleCells = ageCatTitles.map(c => `\\textit{${c}:}`).join(" & ")

            const ageCatValueCells = ageCatTitles.map(c => {
                const catFieldName = ageCategories[c]
                const catValue: string = metadata.ages[catFieldName] || "--"
                return catValue
            }).join(" & ")

            const numCat1 = Math.floor(categories.length / 2)

            const checkedBox = `$\\boxtimes$`
            const uncheckedBox = `$\\square$`

            function catToRow(catName: string) {
                const isRelated = metadata.categories.includes(catName)
                const catChecked = isRelated ? checkedBox : uncheckedBox
                return `${catChecked} ${texEscapeChars(catName)}`
            }

            let catCell1 = `\\textit{Categories:}`
            for (let i = 0; i < numCat1; i++) {
                catCell1 += `\\newline ${catToRow(categories[i])}`
            }

            let catCell2 = ``
            for (let i = numCat1; i < categories.length; i++) {
                if (i !== numCat1) {
                    catCell2 += "\\newline "

                }
                catCell2 += catToRow(categories[i])
            }

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
            // const licenseLogoPath = path.join(__dirname, "resources", "CC_by-sa.pdf")
            const licenseLogoPath = "/Users/jpp/Desktop/bebrastasksupport/src/resources/CC_by-sa.pdf"
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
            const lineIfNeeded = (lastRowType === "header") ? "\\hline\n" : "" // \topstrut doesn't work if followed by \muticolumn...
            return ` \\\\ \n${lineIfNeeded}`
        }
        return ""
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

        let open = "" // default open and close markup
        let close = ""
        if (type === "thead") {
            open = `\\thead{`
            close = `}`
        } else if (type === "makecell") {
            open = `\\makecell{` // TODO insert alignment spec
            close = `}`
        }

        const rowspanStr = token.attrGet("rowspan")
        let rowspan
        if (rowspanStr && (rowspan = parseInt(rowspanStr)) >= 2) {
            // multicolumn
            open = `\\multirow{${rowspan}}{*}{` + open
            close = close + `}`
            state.validMultirows.push({ colIndex, rowIndex, rowspan })
        }

        const colspanStr = token.attrGet("colspan")
        let colspan
        if (colspanStr && (colspan = parseInt(colspanStr)) >= 2) {
            // multicolumn
            open = `\\multicolumn{${colspan}}{c}{` + open
            close = close + `}`
        }

        env.pushState({ currentTableCell: { type, closeWith: close } })
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

    function isSurroundedBy(item: string, distance: number, tokens: Array<Token>, idx: number,): boolean {
        const surrounded = idx - distance >= 0 &&
            idx + distance < tokens.length &&
            tokens[idx - distance].type === `${item}_open` &&
            tokens[idx + distance].type === `${item}_close`
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

        "image": (tokens, idx, env) => {
            const t = tokens[idx]

            const imgPathForHtml = t.attrGet("src")!
            let type = "graphics"
            if (imgPathForHtml.endsWith(".svg")) {
                type = "svg"
            }

            const imgPathIsAbsolute = imgPathForHtml.startsWith("/")
            const imgPath = imgPathIsAbsolute ? imgPathForHtml : "../" + imgPathForHtml

            let title = t.attrGet("title")
            let includeOpts = ""
            let placement = "center"
            let width: string | undefined = undefined
            let match
            if (title && (match = patterns.imageOptions.exec(title))) {
                title = title.replace(patterns.imageOptions, "")
                let value
                if (value = match.groups.width_abs) {
                    const f = roundTenth(parseFloat(value) * HtmlToTexPixelRatio)
                    width = `${f}px`
                    includeOpts = `[width=${width}]`
                } else if (value = match.groups.width_rel) {
                    const f = roundTenth(parseFloat(value.slice(0, value.length - 1)) / 100)
                    width = `${f}\\linewidth`
                    includeOpts = `[width=${width}]`
                }
                if (value = match.groups.placement) {
                    placement = value
                }
            }

            const includeCmd = `\\include${type}${includeOpts}{${imgPath}}`

            let before = ""
            let after = ""

            function useMakecell() {
                before = `\\makecell[c]{`
                after = `}`
            }

            function useCenterEnv() {
                before = `\\begin{center}\n`
                after = `\n\\end{center}`
            }

            if (placement === "center") {
                if (isSurroundedBy("paragraph", 1, tokens, idx)) {
                    if (isSurroundedBy("td", 2, tokens, idx)) {
                        useMakecell()
                    } else if (!env.state().currentTableCell) {
                        useCenterEnv()
                    } else {
                        // in a table cell, not alone; leave as is
                    }
                } else if (isSurroundedBy("td", 1, tokens, idx)) {
                    useMakecell()
                }

            } else {
                // left or right
                const placementSpec = placement[0].toUpperCase()
                if (width) {
                    before = `\\begin{wrapfigure}{${placementSpec}}{${width}}\n`
                    after = `\n\\end{wrapfigure}`

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
            return '$$' + texMath(tokens[idx].content) + '$$'
        },

        "math_block_eqno": (tokens, idx, env) => {
            return '$$' + texMath(tokens[idx].content) + '$$' // TODO add eqno?
        },


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


        "paragraph_open": (tokens, idx, env) => {
            return ""
        },

        "paragraph_close": (tokens, idx, env) => {
            let type
            if (env.state().currentTableCell) {
                // ignore
                return ""
            } else if (idx + 1 < tokens.length && (type = tokens[idx + 1].type).endsWith("_close") && type !== "secbody_close") {
                // ignore, too... // TODO have a system that ensures a certain number of max newlines?
                return ""
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
            return `\\begin{enumerate}\n`
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
            return `\\textbf{`
        },

        "strong_close": (tokens, idx, env) => {
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
            return `\\href{${t.attrGet("href")}}{`
        },

        "link_close": (tokens, idx, env) => {
            return `}`
        },


        "table_open": (tokens, idx, env) => {
            env.pushState({ currentTableRowIndex: -1, validMultirows: [] })

            const t = tokens[idx]

            interface TableMetaSep {
                aligns: Array<string>
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
            for (let i = 0; i < ncols; i++) {
                specs.push(columnSpec(tableMeta.sep.aligns[i], tableMeta.sep.wraps[i]))
            }

            const spec = specs.join(" ")
            return `\\begin{tabularx}{\\columnwidth}{ ${spec} }\n`
        },

        "table_close": (tokens, idx, env) => {
            env.popState()
            return "\n\\end{tabularx}\n\n"
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
            let hasSoftBreaks = false
            const itemsPreventingMakecell = ["table_open", "ordered_list_open", "bullet_list_open"]
            let hasItemPreventingMakecell = false
            for (let i = idx + 1; i < tokens.length; i++) {
                const type = tokens[i].type
                if (type === "td_close") {
                    break
                } else if (type === "softbreak") {
                    hasSoftBreaks = true
                } else if (itemsPreventingMakecell.includes(type)) {
                    hasItemPreventingMakecell = true
                }
            }
            const cellType = (hasSoftBreaks && !hasItemPreventingMakecell) ? "makecell" : "plain"
            return openCellPushingState(cellType, tokens[idx], env)
        },

        "td_close": (tokens, idx, env) => {
            return closeCellPoppingState(env)
        },


        "container_center_open": (tokens, idx, env) => {
            return `\\begin{center}\n`
        },

        "container_center_close": (tokens, idx, env) => {
            return `\n\\end{center}\n\n`
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

        "main_open": skip,
        "main_close": skip,
        "secbody_open": skip,
        "secbody_close": skip,

        "tocOpen": skip,
        "tocBody": skip,
        "tocClose": skip,

    }


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

    const babels: Dict<string> = {
        eng: `\\usepackage[english]{babel}`,
        deu: `\\usepackage[german]{babel}`,
        ita: `\\usepackage[italian]{babel}`,
        fra: `\\usepackage[french]{babel}
\\frenchbsetup{ThinColonSpace=true}
\\renewcommand*{\\FBguillspace}{\\hskip .4\\fontdimen2\\font plus .1\\fontdimen3\\font minus .3\\fontdimen4\\font \\relax}`,
    }

    const babel = babels[langCode] ?? babels.eng

    return '' +
        `\\documentclass[a4paper,12pt]{report}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}

${babel}
\\AtBeginDocument{\\def\\labelitemi{$\\bullet$}}

\\usepackage{etoolbox}

\\usepackage[margin=2cm]{geometry}
\\usepackage{changepage}
%\\AtBeginEnvironment{adjustwidth}{\\partopsep0pt}
%\\newcommand\\topstrut{\\rule{0pt}{2.6ex}}
%\\newcommand\\bottomstrut{\\rule[-0.9ex]{0pt}{0pt}}
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


\\usepackage{tabularx}
\\usepackage{makecell}
\\usepackage{multirow}
\\renewcommand\\theadfont{\\bfseries}
\\renewcommand{\\tabularxcolumn}[1]{>{}m{#1}}
\\newcolumntype{R}{>{\\raggedleft\\arraybackslash}X}
\\newcolumntype{C}{>{\\centering\\arraybackslash}X}
\\newcolumntype{L}{>{\\raggedright\\arraybackslash}X}

\\usepackage{amssymb}

\\usepackage[babel=true,maxlevel=3]{csquotes}
\\DeclareQuoteStyle{bebras-ch-deu}{«}[» ]{»}{“}[»› ]{”}
\\DeclareQuoteStyle{bebras-ch-fra}{«\\thinspace{}}[» ]{\\thinspace{}»}{“}[»\\thinspace{}› ]{”}
\\DeclareQuoteStyle{bebras-ch-ita}{«}[» ]{»}{“}[»› ]{”}
\\setquotestyle{bebras-ch-${langCode}}

\\usepackage{hyperref}
\\usepackage{graphicx}
\\usepackage{svg}
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

\\begin{document}
${taskTex}
\\end{document}
`

};

