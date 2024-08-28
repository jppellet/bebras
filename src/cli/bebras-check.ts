import path = require('path')

import { Command } from 'commander'
import _ = require('lodash')

import { check, reportDiagnostics } from '../check'
import { ensureIsTaskFile, readFileStrippingBom } from '../fsutil'

export function makeCommand_check() {
    return new Command()
        .name("check")
        .alias("k")
        .description('Checks the validity of a task file')
        .option('-a, --all', 'include strict checks (e.g. for bebras-web)', false)
        .argument("<task-file>", 'the source task file')
        .action(doCheck)
}

async function doCheck(taskFile: string, options: any) {
    const strictChecks = !!options.all
    console.log(strictChecks, options)

    await ensureIsTaskFile(taskFile, true)

    const text = await readFileStrippingBom(taskFile)
    const diags = await check(text, taskFile, strictChecks)
    if (diags.length === 0) {
        console.log(`${taskFile}: all checks passed`)
    } else {
        reportDiagnostics(diags, text, taskFile, console.log)
    }

}
