import path = require('path')
import fs = require('fs-extra')

import { Command } from 'commander'

import patterns = require('./patterns')
import { ensureIsTaskFile, fatalError, mkStringCommaAnd, modificationDateIsLater, OutputFormat, OutputFormats } from './util'

export function makeCommand_check() {
    return new Command()
        .name("check")
        .alias("k")
        .description('Checks the validity of a task file')
        .argument("<task-file>", 'the source task file')
        .action(check)
}

function check(taskFile: string, options: any) {

    ensureIsTaskFile(taskFile, true)

    require("./tasklint").runTerminal(taskFile)
}