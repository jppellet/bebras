import path = require('path')
import fs = require('fs-extra')

import { Command } from 'commander'

import patterns = require('../patterns')
import { ensureIsTaskFile, fatalError, mkStringCommaAnd, modificationDateIsLater, OutputFormat, OutputFormats } from '../util'

export function makeCommand_convert() {
    return new Command()
        .name("convert")
        .alias("c")
        .description('Converts a task file into various formats')
        .option('-o, --output-file <file>', 'manually indicate where to store the output file')
        .option('-f, --force', 'force regeneration of output file', false)
        .argument("<format>", 'the output format, ' + OutputFormats.values.join("|"))
        .argument("<task-file>", 'the source task file')
        .action(convert)
}


function convert(format: string, taskFile: string, options: any) {
    const force = !!options.force

    if (!OutputFormats.isValue(format)) {
        fatalError("unknown format: " + format + ". Valid formats are " + mkStringCommaAnd(OutputFormats.values))
    }

    ensureIsTaskFile(taskFile, true)

    const outputFile = "" + (options.outputFile ?? standardOutputFile(taskFile, format))

    if (!force && fs.existsSync(outputFile) && !modificationDateIsLater(taskFile, outputFile)) {
        console.log(`Output file '${outputFile}' seems up to date.`)
        process.exit(0)
    }

    const outputDir = path.dirname(outputFile)

    if (!fs.existsSync(outputDir)) {
        fs.mkdirsSync(outputDir)
    }

    require('../convert_' + format).convertTask(taskFile, outputFile)
}


function standardOutputFile(taskFile: string, format: OutputFormat): string {
    const outputOpts = OutputFormats.propsOf(format)
    const parentFolder = path.dirname(taskFile)
    const basename = path.basename(taskFile, patterns.taskFileExtension)
    return path.join(parentFolder, ...outputOpts.pathSegments, basename + outputOpts.extension)
}
