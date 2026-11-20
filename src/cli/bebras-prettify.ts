import * as fs from 'fs'

import { Command } from 'commander'

import { findTasksFilesOrEnsureIsTaskFile, readFileStrippingBom } from '../fsutil'
import { prettifyTask } from '../prettify'
import { BottomProgressBar, fatalError } from '../util'

export function makeCommand_prettify() {
    return new Command()
        .name("prettify")
        .alias("p")
        .description('Prettifies a task file')
        .option('-r, --recursive', 'batch converts all tasks file in the source folder', false)
        .option('-F, --filter <pattern>', 'when in recursive mode, only consider files matching this pattern', false)
        .argument("<source>", 'the source task file (or folder if -r is used)')
        .action(prettify)
}

async function prettify(source: string, options: any): Promise<void> {
    const isRecursive = Boolean(options.recursive)
    const filter: string | undefined = options.filter


    const { taskFiles } = await findTasksFilesOrEnsureIsTaskFile(source, isRecursive, filter)
    if (taskFiles.length === 0) {
        fatalError("No task file found in " + source)
    }

    let numWritten = 0
    let numUpToDate = 0
    const immediateLog = taskFiles.length === 1

    await BottomProgressBar.showWhile(taskFiles.length, async pbar => {
        for (const taskFile of taskFiles) {

            const contents = await readFileStrippingBom(taskFile)
            const eol = contents.includes("\r\n") ? "\r\n" : "\n"
            const prettified = prettifyTask(taskFile, contents, eol, { skipTables: true })

            if (prettified === contents) {
                if (immediateLog) {
                    console.log(`Output file '${taskFile}' is already prettified.`)
                }
                numUpToDate++
            } else {
                fs.writeFileSync(taskFile, prettified, 'utf-8')
                if (immediateLog) {
                    console.log(`Wrote prettified file '${taskFile}'.`)
                }
                numWritten++
            }

            if (!immediateLog) {
                pbar.update(taskFile)
            }

        }
    })

    if (!immediateLog) {
        console.log(`Prettified ${numWritten} file${numWritten > 1 ? "s" : ""}${numUpToDate === 0 ? '' : `; ${numUpToDate} already prettified`}.`)
    }
}
