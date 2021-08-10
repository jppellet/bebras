#!/usr/bin/env node

import { Command } from 'commander'
import { makeCommand_convert } from './bebras-convert'
import { makeCommand_check } from './bebras-check'
import { makeCommand_find } from './bebras-find'

(() => {

    const VERSION = require('../../package.json').version

    const program = new Command()
        .name("bebras")
        .version(VERSION, '-v, --vers')

    program
        .addCommand(makeCommand_convert().showHelpAfterError())
        .addCommand(makeCommand_check().showHelpAfterError())
        .addCommand(makeCommand_find().showHelpAfterError())
        .addHelpCommand(false)
        .showHelpAfterError()

    program.parse(process.argv)

})()