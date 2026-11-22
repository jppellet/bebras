import * as fs from "fs"
import { prettifyTable } from "../src/prettify"

const TERM_RESET = "\x1b[0m"
const TERM_BOLD = "\x1b[1m"
const TERM_RED = "\x1b[31m"
const TERM_GREEN = "\x1b[32m"
const TERM_LIGHTGREY = "\x1b[38;2;241;241;241m"

type TestCase = {
    desc: string
    input: string
    expected?: string
}

// Parse test cases from prettifyTables.txt
const testCasesFileRaw = fs.readFileSync("./test/prettifyTables.txt", 'utf-8')
const testCasesRaw = testCasesFileRaw.split("\n\n").filter(line => line.trim() !== "")

const testCases: TestCase[] = []
for (const testCaseRaw of testCasesRaw) {
    const parts = testCaseRaw.split(/\n\.\n*/)
    if (parts.pop()?.length !== 0 || parts.length < 2 || parts.length > 3) {
        throw new Error("Invalid test case format: " + testCaseRaw)
    }
    testCases.push({
        desc: parts[0].trim(),
        input: parts[1],
        expected: parts.length > 2 ? parts[2] : undefined,
    })
}

// Run test cases
let n = 0
const len = testCases.length
let numFailed = 0
for (const { desc, input, expected } of testCases) {
    n++
    console.log(`Test ${n} of ${len} - ${desc}`)
    const actual = prettifyTable(input, "\n", false)
    if (expected === undefined || expected === "") {
        console.log(`\n\n` + actual + `\n`)
    } else {
        if (actual !== expected) {
            const makeWhitespaceVisible = (s: string) => s.replace(/ /g, `${TERM_LIGHTGREY}·${TERM_RESET}`).replace(/\t/g, `${TERM_LIGHTGREY}-→${TERM_RESET}`).replace(/\n/g, `${TERM_LIGHTGREY}␊${TERM_RESET}\n`) + `${TERM_LIGHTGREY}␄${TERM_RESET}`
            console.log(`${TERM_RED} -> Test failed: actual output differs from expected${TERM_RESET}`)
            console.log(`\n\nInput:\n` + makeWhitespaceVisible(input) + `\n`)
            console.log(`\n\nActual:\n` + makeWhitespaceVisible(actual) + `\n`)
            console.log(`\n\nExpected:\n` + makeWhitespaceVisible(expected) + `\n`)
            console.log(`\nLog:`)
            prettifyTable(input, "\n", true)
            numFailed++
        } else {
            console.log(`${TERM_GREEN} -> Test passed${TERM_RESET}`)
        }
    }
}

// Summary
const allTestsPassed = numFailed === 0
if (allTestsPassed) {
    console.log(`${TERM_BOLD}${TERM_GREEN}All ${len} tests passed.${TERM_RESET}`)
} else {
    console.log(`${TERM_BOLD}${TERM_RED}${numFailed} of ${len} tests failed.${TERM_RESET}`)
}