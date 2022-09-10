import * as fs from 'fs'

import { Command } from 'commander'

import { defaultOutputFile, ensureIsTaskFile, fatalError, mkStringCommaAnd, modificationDateIsLater, OutputFormats } from '../util'

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


async function convert(format: string, taskFile: string, options: any): Promise<void> {
    const force = !!options.force

    if (!OutputFormats.isValue(format)) {
        fatalError("unknown format: " + format + ". Valid formats are " + mkStringCommaAnd(OutputFormats.values))
    }

    await ensureIsTaskFile(taskFile, true)

    const outputFile = "" + (options.outputFile ?? defaultOutputFile(taskFile, format))

    if (!force && (fs.existsSync(outputFile)) && !(await modificationDateIsLater(taskFile, outputFile))) {
        console.log(`Output file '${outputFile}' seems up to date.`)
        process.exit(0)
    }

    const convModule = require('../convert_' + format)
    const res = await convModule["convertTask_" + format](taskFile, outputFile)
}
