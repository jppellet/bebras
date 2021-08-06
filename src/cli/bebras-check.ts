import path = require('path')
import fs = require('fs-extra')

import { Command } from 'commander'
import _ = require('lodash')

import patterns = require('../patterns')
import { ensureIsTaskFile, fatalError, mkStringCommaAnd, modificationDateIsLater, OutputFormat, OutputFormats, readFileSyncStrippingBom } from '../util'
import { check } from '../check'

export function makeCommand_check() {
    return new Command()
        .name("check")
        .alias("k")
        .description('Checks the validity of a task file')
        .argument("<task-file>", 'the source task file')
        .action(doCheck)
}

function doCheck(taskFile: string, options: any) {

    ensureIsTaskFile(taskFile, true)

    const text = readFileSyncStrippingBom(taskFile)
    let filename: string = path.basename(taskFile)
    if (filename.endsWith(patterns.taskFileExtension)) {
        filename = filename.slice(0, filename.length - patterns.taskFileExtension.length)
    }
    const diags = check(text, filename)
    const indent = "  "
    if (diags.length === 0) {
        console.log(`${taskFile}: all checks passed`)
    } else {
        for (const diag of diags) {
            const [line, offset] = lineOf(diag.start, text)
            const length = Math.min(line.length - offset, diag.end - diag.start)
            console.log(`[${diag.type}]: ${diag.msg}`)
            console.log(indent + line)
            const highlight = _.pad("", indent.length + offset, " ") + _.pad("", length, "^")
            console.log(highlight)
        }
    }
}

function lineOf(position: number, source: string): [string, number] {
    let start = position - 1
    while (source.charCodeAt(start) !== 0x0A && start >= 0) {
        start--
    }
    start++

    const last = source.length - 1
    let end = start
    while (source.charCodeAt(end) !== 0x0A && end <= last) {
        end++
    }

    let line = source.slice(start, end)
    let offset = position - start

    const ellipsis = "[...] "
    const cutoff = 100
    if (offset > cutoff) {
        line = ellipsis + line.slice(cutoff)
        offset -= cutoff - ellipsis.length
    }
    return [line, offset]
}