import * as fs from 'fs'
import * as path from 'path'

import { Command } from 'commander'

import { defaultOutputFile, defaultOutputFilename, ensureIsTaskFile, fatalError, findTaskFilesRecursively, mkStringCommaAnd, modificationDateIsLater, OutputFormat, OutputFormats } from '../util'

export function makeCommand_convert() {
    return new Command()
        .name("convert")
        .alias("c")
        .description('Converts a task file into various formats')
        .option('-o, --output <file>', 'manually indicate where to store the output file')
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

    const convModule = require('../convert_' + format)

    for (const taskFile of taskFiles) {
        const outputFile = getOutputFile(options.output, taskFile, isRecursive, format)
        const outputFileDir = path.dirname(outputFile)

        if (!force && (fs.existsSync(outputFile)) && !(await modificationDateIsLater(taskFile, outputFile))) {
            console.log(`Output file '${outputFile}' seems up to date.`)
            continue
        }

        // console.log(`Converting '${taskFile}' to '${outputFile}'...`)

        /*const res =*/ await convModule["convertTask_" + format](taskFile, outputFile)
    }

}

function getOutputFile(outputFileOption: string | undefined, taskFile: string, isRecursive: boolean, format: OutputFormat): string {
    if (outputFileOption) {
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
