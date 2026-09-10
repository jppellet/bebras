#!/usr/bin/env node --no-deprecation

import { Command } from 'commander'
import { BebrasCommandError } from '../util'
import { makeCommand_check } from './bebras-check'
import { makeCommand_convert } from './bebras-convert'
import { makeCommand_find } from './bebras-find'
import { makeCommand_server } from './bebras-server'

async function main(): Promise<void> {
    const VERSION = require('../../package.json').version

    const program = new Command()
        .name("bebras")
        .version(VERSION, '-v, --vers')

    program
        .addCommand(makeCommand_convert().showHelpAfterError())
        .addCommand(makeCommand_check().showHelpAfterError())
        .addCommand(makeCommand_find().showHelpAfterError())
        .addCommand(makeCommand_server().showHelpAfterError())
        .addHelpCommand(false)
        .showHelpAfterError()

    await program.parseAsync(process.argv)
}

main().catch((err: unknown) => {
    if (err instanceof BebrasCommandError) {
        console.log(`error: ${err.message}`)
        process.exitCode = 1
    } else {
        // Unexpected programming/system error
        console.error(err)
        process.exitCode = 2
    }
})