import * as fs from 'fs'
import * as path from 'path'

import { Command } from 'commander'

import { ensureIsTaskFile, findTaskFilesRecursively, modificationDateIsLater } from '../fsutil'
import { defaultOutputFile, defaultOutputFilename, fatalError, isString, mkStringCommaAnd, OutputFormat, OutputFormats } from '../util'

export function makeCommand_convert() {
    return new Command()
        .name("convert")
        .alias("c")
        .description('Converts a task file into various formats')
        .option('-o, --output <file>', 'manually indicate where to store the output file\n(or - to indicate stdout if the output is a single file)')
        .option('-f, --force', 'force regeneration of output file', false)
        .option('-r, --recursive', 'batch converts all tasks file in the source folder', false)
        .option('-F, --filter <pattern>', 'when in recursive mode, only consider files matching this pattern', false)
        .argument("<format>", 'the output format, ' + OutputFormats.values.join("|"))
        .argument("<source>", 'the source task file (or folder if -r is used)')
        .action(convert)
}


async function convert(format: string, source: string, options: any): Promise<void> {
    const force = !!options.force
    const isRecursive = !!options.recursive

    if (!OutputFormats.isValue(format)) {
        fatalError("unknown format: " + format + ". Valid formats are " + mkStringCommaAnd(OutputFormats.values))
    }

    const taskFiles = await findTaskFiles(source, isRecursive, options.filter)
    if (taskFiles.length === 0) {
        fatalError("No task file found in " + source)
    }

    const toStdOut = options.output === '-'
    if (toStdOut && taskFiles.length > 1) {
        fatalError("Cannot output multiple files to stdout")
    }

    const convModule: any = require('../convert_' + format)

    for (const taskFile of taskFiles) {
        const output = getOutputDestination(options.output, taskFile, isRecursive, format)

        if (isString(output)) {
            const outputFileDir = path.dirname(output)

            if (!force && (fs.existsSync(output)) && !(await modificationDateIsLater(taskFile, output))) {
                console.log(`Output file '${output}' seems up to date.`)
                continue
            }
        }

        // console.log(`Converting '${taskFile}' to '${outputFile}'...`)

        const methodName = "convertTask_" + format
        const pathOrTrue: string | true = await convModule[methodName](taskFile, output)

    }

}

function getOutputDestination(outputFileOption: string | undefined, taskFile: string, isRecursive: boolean, format: OutputFormat): string | true {
    if (outputFileOption) {
        if (outputFileOption === '-') {
            return true
        }
        if (isRecursive) {
            // must be a directory
            return path.join(outputFileOption, defaultOutputFilename(taskFile, format))
        } else {
            // must be a file
            return outputFileOption
        }
    }
    return defaultOutputFile(taskFile, format)
}


async function findTaskFiles(source: string, recursive: boolean, pattern: string | undefined): Promise<string[]> {
    // returns an error or a list of task files
    if (recursive) {
        if (!fs.existsSync(source)) {
            fatalError("source folder does not exist: " + source)
        }
        if (!fs.lstatSync(source).isDirectory()) {
            fatalError("source folder is not a directory: " + source)
        }
        return findTaskFilesRecursively(source, pattern)
    } else {
        ensureIsTaskFile(source, true)
        return [source]
    }
}
