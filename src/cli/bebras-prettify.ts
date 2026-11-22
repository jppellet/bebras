import * as fs from 'fs'

import { Command } from 'commander'

import { findTasksFilesOrEnsureIsTaskFile, readFileStrippingBom } from '../fsutil'
import { defaultPrettifyOptions, prettifyTask, prettityOptionsDescription } from '../prettify'
import { BottomProgressBar } from '../util'

export function makeCommand_prettify() {
    let cmd = new Command()
        .name("prettify")
        .alias("p")
        .description('Prettifies a task file')
        .option('-r, --recursive', 'batch converts all tasks file in the source folder', false)
        .option('-F, --filter <pattern>', 'when in recursive mode, only consider files matching this pattern', false)

    const prettyOptions = prettityOptionsDescription()
    const defaultOptions = defaultPrettifyOptions()

    for (const [key, desc] of Object.entries(prettyOptions)) {
        const defaultValue = defaultOptions[key as keyof typeof defaultOptions]
        cmd = cmd
            .option(`--${key}`, `${desc[0].toLowerCase() + desc.substring(1)} (default: ${defaultValue ? "enabled" : "disabled"})`)
            .option(`--no-${key}`, `disables step ${key}`)
    }

    return cmd
        .argument("<source>", 'the source task file (or folder if -r is used)')
        .action(prettify)
}

async function prettify(source: string, options: any): Promise<void> {
    const isRecursive = Boolean(options.recursive)
    const filter: string | undefined = options.filter

    const { taskFiles } = await findTasksFilesOrEnsureIsTaskFile(source, isRecursive, filter)

    const prettifyOptions = defaultPrettifyOptions()
    for (const key of Object.keys(prettifyOptions)) {
        if (key in options) {
            prettifyOptions[key as keyof typeof prettifyOptions] = Boolean(options[key])
        }
    }

    let numWritten = 0
    let numUpToDate = 0
    const immediateLog = taskFiles.length === 1

    await BottomProgressBar.showWhile(taskFiles.length, async pbar => {
        for (const taskFile of taskFiles) {
            const contents = await readFileStrippingBom(taskFile)
            const eol = contents.includes("\r\n") ? "\r\n" : "\n"
            const prettified = prettifyTask(taskFile, contents, eol, prettifyOptions)

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
