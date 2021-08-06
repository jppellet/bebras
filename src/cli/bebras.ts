#!/usr/bin/env node

import path = require('path')
import fs = require('fs-extra')

import { Command } from 'commander'
import { makeCommand_convert } from './bebras-convert'
import { makeCommand_query } from './bebras-query'
import { makeCommand_check } from './bebras-check'

(() => {

    const VERSION = require('../../package.json').version

    const program = new Command()
        .name("bebras")
        .version(VERSION, '-v, --vers')

    program
        .addCommand(makeCommand_convert().showHelpAfterError())
        .addCommand(makeCommand_query().showHelpAfterError())
        .addCommand(makeCommand_check().showHelpAfterError())
        .addHelpCommand(false)
        .showHelpAfterError()

    program.parse(process.argv)

})()