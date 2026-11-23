
import * as path from 'path'
import { parseMarkdown } from './convert_html'
import { patterns } from './main'
import { CapturesOf, imageDefinitionPattern, tableHeaderOrSepPattern } from './patterns'
import { TaskMetadata } from './util'
import MarkdownIt = require('markdown-it')

export function defaultPrettifyOptions() {
    const True = true as boolean
    return {
        preamble: True,
        tables: True,
        imageDefs: True,
        sections: True,
        emptyLines: True,
    } satisfies Record<string, boolean> // boolean needed for assumptions in command line options
}

export type PrettifyOptions = ReturnType<typeof defaultPrettifyOptions>

export function prettityOptionsDescription(): { [K in keyof PrettifyOptions]: string } {
    // also update them in the vscode extension settings
    return {
        preamble: "Remove empty lines in the preamble and ensure proper indentation",
        tables: "Align table cells and separators",
        imageDefs: "Align image definitions in blocks",
        sections: "Ensure proper spacing around section titles",
        emptyLines: "Remove excessive empty lines",
    }
}

export function prettifyTask(taskFile: string, contents: string, eol: string, _options?: Partial<PrettifyOptions>): string {

    const options = { ...defaultPrettifyOptions(), ..._options }
    const basePath = path.dirname(taskFile)

    let prettified = contents

    if (options.emptyLines) {
        // replace all more than 2 empty lines with exactly 2 empty lines
        prettified = prettified
            .replace(/(?:\r?\n){4,}/g, eol.repeat(3))
    }

    if (options.sections) {
        // ensure we always have three eols before sections titles with ##
        prettified = prettified
            .replace(/(?:\r?\n){1,}##/g, eol.repeat(3) + "##")
    }

    // normalize end of file
    prettified = prettified.trim()

    const lines = prettified.split(/\r?\n/)

    let lastPreambleLineIndex = lines.indexOf("---", 1)
    if (options.preamble) {
        if (lastPreambleLineIndex > 0) {
            for (let i = 1; i < lastPreambleLineIndex; i++) {
                // if indented, then at least 2 spaces
                if (lines[i].startsWith(" ") && !lines[i].startsWith("  ")) {
                    lines[i] = "  " + lines[i].substring(1)
                }

                // if list, then indented
                if (lines[i].startsWith("-")) {
                    lines[i] = "  " + lines[i]
                }

                // remove all empty lines in the preamble
                if (lines[i].trim().length === 0) {
                    lines.splice(i, 1)
                    i--
                    lastPreambleLineIndex--
                }
            }

            // ensure two empty lines after the preamble
            if (lines[lastPreambleLineIndex + 1]?.trim().length !== 0) {
                lines.splice(lastPreambleLineIndex + 1, 0, "")
            }
            if (lines[lastPreambleLineIndex + 2]?.trim().length !== 0) {
                lines.splice(lastPreambleLineIndex + 2, 0, "")
            }

        } else {
            // no preamble, generate one with sensible helpful defaults
            const filename = path.basename(taskFile)
            const idMatch = patterns.taskFileName.exec(filename)
            const metadata: Partial<TaskMetadata> = TaskMetadata.defaultValue(taskFile, idMatch?.groups.id)
            delete metadata.filePath
            delete metadata.equivalent_tasks
            delete metadata.keywords
            delete metadata.computational_thinking_skills
            const folderName = path.basename(path.dirname(path.resolve(taskFile)))
            if (folderName.startsWith(metadata.id!)) {
                const taskName = folderName.substring(metadata.id!.length).replace(/[\-_]/g, " ").trim()
                if (taskName.length > 0) {
                    metadata.name = taskName
                }
            }
            // local beautification of the default yaml
            const preambleYaml = TaskMetadata.toYaml(metadata)
                .replace(/: \[\]\n/g, ":\n  - ((unspecified))\n")
                .replace(/: '\-\-'/g, ": --")
            const preambleLines = preambleYaml.split(/\r?\n/).filter(line => line.trim().length > 0)
            if (lines[0].trim() !== "---") {
                lines.unshift("---")
                lastPreambleLineIndex++
            }
            lines.splice(1, 0, ...preambleLines, "---", "", "")
            lastPreambleLineIndex += preambleLines.length + 1
        }
    }

    // exactly one empty line after each section title
    if (options.sections) {

        const neededSections: string[] = [...patterns.markdownSectionNamesFor("latest")]

        for (let i = lastPreambleLineIndex; i < lines.length; i++) {
            if (lines[i].startsWith("##")) {
                const sectionName = lines[i].substring(2).trim()
                const neededSectionsIndex = neededSections.findIndex(s => sectionName.startsWith(s))
                if (neededSectionsIndex >= 0) {
                    neededSections.splice(neededSectionsIndex, 1)
                }

                if (lines[i + 1]?.trim().length !== 0) {
                    lines.splice(i + 1, 0, "")
                }
                if ((lines[i + 2]?.trim()?.length ?? -1) === 0) {
                    lines.splice(i + 2, 1)
                }
            }
        }

        // add missing sections if needed
        if (neededSections.length > 0) {
            // remove empty lines at the end of the file
            for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i].trim().length === 0) {
                    lines.splice(i, 1)
                } else {
                    break
                }
            }
            // section titles
            for (const missingSection of neededSections) {
                lines.push("", "", "## " + missingSection, "", "...")
            }
        }

    }

    if (options.imageDefs) {
        type ImageDef = CapturesOf<typeof imageDefinitionPattern>
        const imageDefs: Array<ImageDef> = []
        for (let i = lastPreambleLineIndex; i < lines.length; i++) {
            // consecutive picture definitions
            const match = imageDefinitionPattern.exec(lines[i])
            if (match) {
                // enqueue
                imageDefs.push(match.groups)
            } else if (imageDefs.length > 1) {
                // we have a block of image definitions to prettify
                for (const [field, shouldPad] of [
                    ["label", () => true],
                    ["path", (def: ImageDef) => def.alt !== undefined],
                ] as const) {
                    const maxLen = imageDefs.reduce((max, def) => Math.max(max, def[field]?.length ?? 0), 0)
                    for (const def of imageDefs) {
                        if (def[field] && shouldPad(def)) {
                            const padding = " ".repeat(maxLen - def[field]!.length)
                            def[field] = def[field]! + padding
                        }
                    }
                }

                // replace the lines with the prettified version
                for (let j = 0; j < imageDefs.length; j++) {
                    const def = imageDefs[j]
                    let line = `${def.label} ${def.path}`
                    if (def.alt) {
                        line += ` "${def.alt}"`
                    }
                    lines[i - imageDefs.length + j] = line
                }

                imageDefs.length = 0 // reset for next block
            }
        }
    }

    // some actions which require parsing the markdown now
    prettified = lines.join(eol)
    const { tokens } = parseMarkdown(prettified, taskFile, basePath, {})

    const magicOffset = 5 // wtf
    let replacementOffset = 0

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]
        if (options.tables && token.type === "table_open") {
            const lineFrom = replacementOffset + token.map![0] - magicOffset
            const lineTo = replacementOffset + token.map![1] - magicOffset
            const tableLines = lines.slice(lineFrom, lineTo)
            const origNumTableLines = tableLines.length
            const origTable = tableLines.join(eol)
            const prettifiedTable = prettifyTable(origTable, eol, false)
            // console.log({ origTable, prettifiedTable })
            const newTableLines = prettifiedTable.split(/\r?\n/)
            lines.splice(lineFrom, origNumTableLines, ...newTableLines)
            replacementOffset += newTableLines.length - origNumTableLines
        }
    }

    prettified = lines.join(eol) + eol
    return prettified
}

export function prettifyTable(orig: string, eol: string, _debug: boolean = false): string {
    const debug = _debug ? console.log : () => { }

    const rawLinesIndented = orig.split(/\r?\n/)
    const globalIndentSize = rawLinesIndented.map(line => line.match(/^\s*/)?.[0].length ?? 0).reduce((a, b) => Math.min(a, b), Infinity)
    const globalIndent = isFinite(globalIndentSize) ? " ".repeat(globalIndentSize) : ""
    const rawLines = rawLinesIndented.map(line => line.substring(globalIndentSize).trimEnd())

    const SEP_BAR = "|"
    const SEP_DOUBLE_BAR = "‖"

    type Sep = typeof SEP_BAR | typeof SEP_DOUBLE_BAR | ""

    type TextCell =
        | { type: "text", text: string, colspan: number }
        | { type: "collapsed" }

    type RowSepLine = { type: "sepline", cells: TextCell[], seps: Sep[] }
    type RowEmpty = { type: "empty", cells: undefined }
    type RowText = { type: "text", cells: TextCell[], seps: Sep[], numTrailingBackslash: number }
    type Row = RowSepLine | RowEmpty | RowText

    // Parses a row
    function rowFromLine(line: string): Row {
        if (line.trim().length === 0) {
            return { type: "empty", cells: undefined }
        }

        const cells: TextCell[] = []
        const seps: Sep[] = []
        let lastSep = -1

        function pushCell(start: number, end: number) {
            // collapsed?
            let isCollapsed = false
            if (end === start) {
                // find last non-collapsed cell
                let i = cells.length - 1
                while (i >= 0 && cells[i].type === "collapsed") {
                    i--
                }
                if (i >= 0) {
                    (cells[i] as Extract<TextCell, { type: "text" }>).colspan++
                    cells.push({ type: "collapsed" })
                    isCollapsed = true
                }
            }
            if (!isCollapsed) {
                // trim 1 space from start
                if (line.charAt(start) === " ") {
                    start++
                }
                // trim all spaces from end and replace tabs with spaces
                const cell = line.substring(start, end).trimEnd().replace(/\t/g, "  ")
                cells.push({ type: "text", text: cell, colspan: 1 })
            }
        }

        // first char, maybe a sep, maybe not
        if (line[0] === SEP_BAR || line[0] === SEP_DOUBLE_BAR) {
            seps.push(line[0])
            lastSep = 0
        } else {
            seps.push("")
        }

        // actual cells
        let skipping = false
        for (let i = lastSep + 1; i < line.length; i++) {
            const c = line[i]
            if (c === '`') {
                // skip verbatim content, which may contain | or ‖
                skipping = !skipping
            }
            if (!skipping && (c === SEP_BAR || c === SEP_DOUBLE_BAR)) {
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

        const isSepLine = tableHeaderOrSepPattern.test(line)
        if (isSepLine) {
            return { type: "sepline", cells, seps }
        }

        let numTrailingBackslash = 0
        const lastCell = cells[cells.length - 1]
        if (lastCell?.type === "text") {
            if (lastCell.text === "\\" || lastCell.text === "\\\\") {
                cells.pop()
                seps.pop()
                numTrailingBackslash = lastCell.text.length
            } else if (lastCell.text.endsWith("\\")) {
                // how many?
                const match = lastCell.text.match(/(?<bk>\\+)$/)
                if (match) {
                    numTrailingBackslash = match.groups?.bk.length ?? 0
                    lastCell.text = lastCell.text.substring(0, lastCell.text.length - numTrailingBackslash).trimEnd()
                }
            }
        }

        return { type: "text", cells, seps, numTrailingBackslash }
    }

    // Parse rows
    const rows = rawLines.map(rowFromLine)
    if (rows.length === 0) {
        debug(`prettifyTable: no rows in table`)
        return orig
    }
    debug(`prettifyTable: ${rows.length} rows in table`)

    // Remove trailing backslashes where it cannot be
    let lastNonTextRowIndex = rows.length
    while (lastNonTextRowIndex > 0) {
        for (let i = lastNonTextRowIndex - 1; i >= 0; i--) {
            const row = rows[i]
            if (row.type === "text") {
                row.numTrailingBackslash = 0  // last text row cannot have a trailing backslash
                // find next non-text row
                lastNonTextRowIndex = -1
                for (let j = i - 1; j >= 0; j--) {
                    if (rows[j].type !== "text") {
                        lastNonTextRowIndex = j
                        break
                    }
                }
                break
            }
        }
    }

    // Count the number of columns
    const numCols = rows.reduce((acc, row) => Math.max(acc, row.cells?.length ?? 0), 0)
    if (numCols === 0) {
        debug(`prettifyTable: no columns in table`)
        return orig
    }
    debug(`prettifyTable: ${numCols} columns in table`)

    // Pad the number of cells in each row to match the number of columns
    for (const row of rows) {
        if (row.type !== "text") { continue }
        while (row.cells.length < numCols) {
            row.cells.push({ type: "text", text: "", colspan: 1 })
            row.seps.push(SEP_BAR)
        }
    }

    // Determine first separation row
    const firstSepRowIndex = rows.findIndex(row => row.type === "sepline")
    if (firstSepRowIndex === -1) {
        debug(`prettifyTable: no separation row in table`)
        return orig
    }
    const referenceSepRow = rows[firstSepRowIndex] as RowSepLine

    // Normalize the number of cells in the reference separation row
    if (referenceSepRow.cells.length < numCols) {
        const lastSep = referenceSepRow.seps.pop()
        for (let i = referenceSepRow.cells.length; i < numCols; i++) {
            referenceSepRow.cells.push({ type: "text", text: "---", colspan: 1 })
            referenceSepRow.seps.push(SEP_BAR)
        }
        if (lastSep) {
            referenceSepRow.seps.push(lastSep)
        }
    }

    // Measure the width of each cell
    const minCellWidth = 3
    const maxCellWidth = 70
    const cellWidths: number[] = new Array(numCols).fill(minCellWidth)
    // ordinary cells first
    for (const row of rows) {
        if (row.type === "empty") { continue }
        const compressHyphen = row.type === "sepline"

        for (let i = 0; i < row.cells.length; i++) {
            const cell = row.cells[i]
            if (cell.type === "text" && cell.text.length <= maxCellWidth && cell.colspan === 1) {
                const cellText = compressHyphen ? cell.text.replace(/-+/g, "-") : cell.text
                cellWidths[i] = Math.max(cellWidths[i], cellText.length)
            }
        }
    }
    // cells with colspan > 1 next
    for (const row of rows) {
        if (row.type !== "text") { continue }

        for (let i = 0; i < row.cells.length; i++) {
            const cell = row.cells[i]
            if (cell.type !== "text" || cell.text.length > maxCellWidth || cell.colspan === 1) { continue }

            const widths = cellWidths.slice(i, i + cell.colspan)
            // each internal " | " becomes "|" in a spanning cell.
            const available = widths.reduce((sum, width) => sum + width, 0)
                + 2 * (cell.colspan - 1)
            const deficit = Math.max(0, cell.text.length - available)

            for (let j = 0; j < cell.colspan; j++) {
                cellWidths[i + j] += Math.floor(deficit / cell.colspan)
                    + (j < deficit % cell.colspan ? 1 : 0)
            }
        }
    }
    debug(`prettifyTable: cell widths = ${cellWidths.join(", ")}`)

    // Determine whether to insert first and last separators
    let insertFirstBar = false
    let insertLastBar = false
    for (const row of rows) {
        if (row.type !== "text") { continue }
        if (row.cells.length === 0) { continue }
        // any first cell that starts with an alignment specifier (e.g., "[") requires the first sep to be inserted
        if (row.cells[0].type === "text" && row.cells[0].text.startsWith("[")) {
            insertFirstBar = true
        }
        const lastCell = row.cells[row.cells.length - 1]
        // any row that ends with a collapsed cell requires the last sep to be inserted
        if (lastCell.type === "collapsed") {
            insertLastBar = true
        }
        // any last cell that is empty requires the last sep to be inserted
        if (lastCell.type === "text" && lastCell.text.trim().length === 0) {
            insertLastBar = true
        }
    }
    if (insertFirstBar && referenceSepRow.seps[0] === "") {
        referenceSepRow.seps[0] = SEP_BAR
    }
    if (insertLastBar && referenceSepRow.seps[referenceSepRow.seps.length - 1] === "") {
        referenceSepRow.seps[referenceSepRow.seps.length - 1] = SEP_BAR
    }

    // Build a row string from a row object
    const buildTextOrSepRow = (row: RowSepLine | RowText, emptyCell: string, pad: (cell: string, width: number, isLast: boolean) => string): string => {
        const parts: string[] = []
        const insertOptionalSep = (force: boolean, before: "" | " ", sep: Sep, after: "" | " ", numTrailingBackslash: number = 0) => {
            if (sep === SEP_DOUBLE_BAR || numTrailingBackslash > 0) {
                parts.push(before + sep + (numTrailingBackslash > 0 ? "\\".repeat(numTrailingBackslash) : "") + after)
            } else if (force) {
                parts.push(before + SEP_BAR + after)
            }
        }
        insertOptionalSep(insertFirstBar, "", referenceSepRow.seps[0], " ")
        let i = 0
        while (i < numCols) {
            const cell: TextCell | undefined = row.cells[i] // undefined if the row has fewer cells than numCols
            if (cell?.type === "collapsed") {
                // all handled by the previous cell, just skip
                i++
                continue
            }
            // text
            const colspan = cell?.colspan ?? 1
            const width = cellWidths.slice(i, i + colspan).reduce((sum, value) => sum + value, 0)
                + 2 * (colspan - 1)
            const isLast = i + colspan >= numCols
            if (cell) {
                parts.push(pad(cell.text, width, isLast))
            } else {
                parts.push(pad(emptyCell, cellWidths[i], isLast))
            }
            // separator(s)
            const end = i + colspan
            if (colspan > 1) {
                parts.push(" ")
                for (let j = i + 1; j < end; j++) {
                    parts.push(SEP_BAR) // internal separators are always single bars
                }
                parts.push(referenceSepRow.seps[end])
                if (end < numCols) {
                    parts.push(" ")
                }
            } else if (end < numCols) {
                parts.push(" " + referenceSepRow.seps[end] + " ")
            } else {
                insertOptionalSep(insertLastBar, " ", referenceSepRow.seps[end], "", row.type !== "text" ? 0 : row.numTrailingBackslash)
            }
            i = end
        }
        return parts.join("")
    }

    const referenceSepRowStr = buildTextOrSepRow(referenceSepRow, "---", (cell, width) => {
        const minized = cell.replace(/--+/g, "-")
        const toPad = width - minized.length
        if (toPad <= 0) {
            return minized
        }
        return minized.replace("-", "-".repeat(toPad + 1))
    })

    let headerWasWritten = false
    const buildRow = (row: Row): string => {
        if (row.type === "empty") {
            return globalIndent
        }
        if (row.type === "sepline") {
            if (!headerWasWritten) {
                headerWasWritten = true
                return globalIndent + referenceSepRowStr
            } else {
                return globalIndent + referenceSepRowStr.replace(new RegExp(`[^ ${SEP_BAR}${SEP_DOUBLE_BAR}]`, "g"), "-")
            }
        }

        let overshot = 0

        return globalIndent + buildTextOrSepRow(row, "   ", (cell: string, width: number, isLast: boolean): string => {
            width -= overshot
            if (isLast && row.numTrailingBackslash > 1) {
                width -= row.numTrailingBackslash - 1
            }
            if (cell.length < width) {
                cell = cell + " ".repeat(width - cell.length)
            } else {
                overshot += cell.length - width
            }
            return cell
        }).trimEnd()
    }

    return rows.map(buildRow).join(eol)
}
