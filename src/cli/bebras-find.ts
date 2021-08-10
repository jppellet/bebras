import { Command } from "commander"
import { fatalError, isString } from "../util"
import * as fs from 'fs'
import * as path from 'path'
import * as jmespath from 'jmespath'

import * as codes from '../codes'
import * as util from '../util'
import * as patterns from '../patterns'
import { astOf } from "../ast"

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
        .option('-s, --sort-by <field>', 'a field to sort by, or \'difficulty\' if a category is set')

    for (let i = 0; i <= 5; i++) {
        cmd = cmd
            .option(`-${i}, --cat${i} [${DefinedDifficulties.join('|')}]`, `only the ${util.AgeCategories[i]} age category (and with the given difficulty)`)
    }

    return cmd
        .action(find)
}


async function find(folder: string, options: any) {
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
                filter = `[?ages."${util.AgeCategories[i]}" != \`--\`] | ` + filter
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
        if (!(lang in codes.languageNameByLanguageCode)) {
            fatalError(`Unknown language: '${lang}'`)
        }
        filter = `[?lang_code == \`${lang}\`] | ` + filter
    }

    let sort = ""
    let optionsSortBy = options.sortBy
    if (isString(optionsSortBy)) {
        if (optionsSortBy === "difficulty") {
            if (setCategory === -1) {
                fatalError("Cannot sort by difficulty when no age category is selected")
            }
            optionsSortBy = `difficulties[${setCategory}]`
        }
        sort = `sort_by(@, &${optionsSortBy}) | `
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


    console.log("options", options)
    console.log("query", q)
    return runQueryOn(taskFiles, q)
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


export async function runQueryOn(taskFiles: string[], query: string) {
    const FORCE_REGEN_AST = true

    const asts = await Promise.all(taskFiles.map(f => astOf(f, FORCE_REGEN_AST)))
    const res = jmespath.search(asts, query)
    if (!util.isNullOrUndefined(res)) {
        if (util.isArray(res)) {
            for (const line of res) {
                console.log(line)
            }
        } else {
            console.log(res)
        }
    }


    // for (const taskFile of taskFiles) {
    //     const ast = await astOf(taskFile, FORCE_REGEN_AST)
    //     try {
    //         const res = jmespath.search(ast, query)
    //         if (!isNullOrUndefined(res)) {
    //             console.log(res)
    //         }
    //     } catch (err) {
    //         let prefix = ""
    //         if (err.name === "ParserError") {
    //             prefix = "Cannot parse query. "
    //         }
    //         console.log(prefix + err.message)
    //         break
    //     }
    // }
}

