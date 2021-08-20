import path = require('path')
import * as fs from 'fs'

import { Command } from 'commander'
import _ = require('lodash')

import { ensureIsTaskFile, readFileStrippingBom } from '../util'
import { check } from '../check'

export function makeCommand_check() {
    return new Command()
        .name("check")
        .alias("k")
        .description('Checks the validity of a task file')
        .argument("<task-file>", 'the source task file')
        .action(doCheck)
}

async function doCheck(taskFile: string, options: any) {

    await ensureIsTaskFile(taskFile, true)

    const text = await readFileStrippingBom(taskFile)
    const diags = check(text, taskFile)
    if (diags.length === 0) {
        console.log(`${taskFile}: all checks passed`)
    } else {
        for (const diag of diags) {
            const linePrefix = `${diag.type.toUpperCase()}: `
            const msgPrefix =  _.pad("",linePrefix.length - 3, " ") + "| "
            const [line, offset] = lineOf(diag.start, text)
            const length = Math.min(line.length - offset, diag.end - diag.start)
            console.log(linePrefix + line)
            const highlight = msgPrefix + _.pad("", linePrefix.length - msgPrefix.length + offset, " ") + _.pad("", length, "^")
            console.log(highlight)
            console.log(msgPrefix + diag.msg.replace(/\n/g, '\n' + msgPrefix) + `\n`)
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
    let c: number
    while ((c = source.charCodeAt(end)) !== 0x0A && c !== 13 && end <= last) {
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