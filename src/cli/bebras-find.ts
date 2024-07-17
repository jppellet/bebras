import { Command } from "commander"
import * as fs from 'fs'
import * as jmespath from 'jmespath'
import * as path from 'path'
import { fatalError, isString } from "../util"

import { isUndefined } from "lodash"
import { astOf, TaskAST } from "../ast"
import * as codes from '../codes'
import * as patterns from '../patterns'
import * as util from '../util'
import _ = require("lodash")

const DefinedDifficulties = [...util.Difficulties]
DefinedDifficulties.shift() // remove '--'

export function makeCommand_find() {
    let cmd = new Command()
        .name("find")
        .alias("f")
        .description('Finds Bebras tasks in a given folder')
        .argument("<folder>", 'the folder in which to find matching tasks')
        .option('-l, --lang <lang_code>', 'only for the given 3-letter language code')
        .option('-i, --id', 'output task id (short for: -q id)')
        .option('-t, --title', 'output task title (short for: -q title)')
        .option('-n, --filename', 'output task filename (short for: -q filename)')
        .option('-p, --filepath', 'output task filepath (default; short for: -q filepath)')
        .option('-q, --query <projection>', 'a custom JMESPath projection, e.g. \'{id: id, name: title}\'')
        .option('-s, --sort-by <field>', 'a (spaceless, comma-delimited list of) fields to sort by, or \'difficulty\' if a category is set')
        .option('-o, --output <file>', 'a file to write the result to (stdout if not specified)')
        .option('-a, --array', 'format output as a JSON array instead of lines of text')
        .option('-u, --uniq', 'remove duplicated output lines or objects')
        .option('--indent <n>', 'JSON indentation (in spaces) to use in the output (default: 2)')
        .option('--debug', 'prints additional debug information')

    for (let i = 0; i <= 5; i++) {
        cmd = cmd
            .option(`-${i}, --cat${i} [${DefinedDifficulties.join('|')}]`, `only the ${util.AgeCategories[i]} age category (and with the given difficulty)`)
    }

    return cmd
        .action(find)
}


async function find(folder: string, options: any) {
    const debug = !!options.debug
    const asArray = !!options.array
    const uniq = !!options.uniq
    const indent = +(options.indent ?? "2")
    const outputFile: string | undefined = options.output
    const projection = options.id ? "[].id" :
        options.title ? "[].title" :
            options.filename ? "[].filename" :
                options.query ? "[]." + options.query :
                    "[].filepath"

    let setCategory = -1
    let filter = ""
    for (let i = 0; i <= 5; i++) {
        const optName = "cat" + i
        const value = options[optName]
        if (value) {
            if (setCategory !== -1) {
                fatalError(`Cannot specify both categories ${setCategory} and ${i}`)
            } if (value === true) {
                filter = `[?!contains(ages."${util.AgeCategories[i]}", \`--\`)] | ` + filter
            } else if (DefinedDifficulties.includes(value)) {
                filter = `[?ages."${util.AgeCategories[i]}" == \`${value}\`] | ` + filter
            } else {
                fatalError(`Unknown difficulty: '${value}'. Shoule be ${util.Difficulties.join('|')}`)
            }
            setCategory = i
        }
    }

    const lang = options.lang
    if (isString(lang)) {
        if (!(lang in codes.languageNameAndShortCodeByLongCode)) {
            fatalError(`Unknown language: '${lang}'`)
        }
        filter = `[?lang_code == \`${lang}\`] | ` + filter
    }

    let sort = ""
    let optionsSortBy = options.sortBy
    if (isString(optionsSortBy)) {
        optionsSortBy.split(/, */).forEach(sortField => {
            if (sortField === "difficulty") {
                if (setCategory === -1) {
                    fatalError("Cannot sort by difficulty when no age category is selected")
                }
            }
            sort = `sort_by(@, &${sortField}) | ` + sort
        })
    }

    const q = `${filter}${sort}${projection}`


    if (!fs.existsSync(folder)) {
        fatalError("folder does not exist: " + folder)
    }

    const isFolder = (await fs.promises.stat(folder)).isDirectory()

    const taskFiles = !isFolder
        ? [(await util.ensureIsTaskFile(folder, false))]
        : findTaskFilesIn(folder)

    if (taskFiles.length === 0) {
        fatalError("no task files in folder: " + folder)
    }

    const enrich: ((ast: TaskAST) => void) | undefined =
        (setCategory === -1) ? undefined : ast => {
            const diffIndex = ast.difficulties[setCategory]
            ast.difficulty = diffIndex
            ast.difficulty_str = util.Difficulties[diffIndex]
        }


    if (debug) {
        console.log("options =", options)
        console.log("query =", q)
    }
    return runQueryOn(taskFiles, q, asArray, uniq, indent, outputFile, enrich)
}


function findTaskFilesIn(folder: string) {
    const taskFiles: string[] = []

    loop(folder)

    function loop(folder: string) {
        fs.readdirSync(folder).forEach(childName => {
            const child = path.join(folder, childName)
            if (fs.statSync(child).isDirectory()) {
                loop(child)
            } else if (childName.endsWith(patterns.taskFileExtension)) {
                taskFiles.push(child)
            }
        })
    }

    return taskFiles
}


export async function runQueryOn(taskFiles: string[], query: string, showAsArray: boolean, uniq: boolean, indent: number, outputFile: string | undefined, enrich?: (ast: TaskAST) => void) {
    const FORCE_REGEN_AST = true

    const asts = await Promise.all(taskFiles.map(f => astOf(f, FORCE_REGEN_AST)))
    if (enrich) {
        asts.forEach(enrich)
    }
    let res = jmespath.search(asts, query)
    if (!util.isNullOrUndefined(res)) {

        function toStringOrJSON(val: any): string {
            return isString(val) ? val : JSON.stringify(val, null, indent)
        }

        let output: string

        if (!util.isArray(res)) {
            output = toStringOrJSON(res)
        } else {
            if (showAsArray) {
                if (uniq) {
                    res = _.uniqBy(res, toStringOrJSON)
                }
                output = toStringOrJSON(res)
            } else {
                // show each line as string
                let outputParts = res.map(toStringOrJSON)
                if (uniq) {
                    outputParts = _.uniq(outputParts)
                }
                output = outputParts.join("\n")
            }
        }

        if (isUndefined(outputFile)) {
            console.log(output)
        } else {
            await fs.promises.writeFile(outputFile, output)
        }
    }
}

