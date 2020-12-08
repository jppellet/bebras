import MarkdownIt = require('markdown-it')
import fs = require('fs')
import { defaultTaskMetadata, readFileSyncStrippingBom, TaskMetadata } from './util'
import Token = require('markdown-it/lib/token')
import { stringify } from 'querystring'
import { defaultLanguageCode } from './codes'

export function runTerminal(fileIn: string, fileOut: string) {
  const mdText = readFileSyncStrippingBom(fileIn)
  const [htmlText, metadata] = renderMarkdown(mdText, true)
  fs.writeFileSync(fileOut, htmlText)
  console.log(`Output written on ${fileOut}`)
}

export function renderMarkdown(text: string, fullHtml: boolean): [string, TaskMetadata] {
  const md = MarkdownIt().use(require("./markdown-it-bebras"))

  const env: any = {}
  const result = md.render(text, env)
  const metadata: TaskMetadata = env.taskMetadata ?? defaultTaskMetadata()

  const htmlStart = '' +
    `<!DOCTYPE html>
     <html lang="en">
       <head>
         <meta charset="utf-8">
         <meta name="viewport" content="width=device-width, initial-scale=1">
         <title>${metadata.id} ${metadata.title}</title>
        <link href="../bebrasmdstyle.css" rel="stylesheet" />
       </head>
       <body>`

  const htmlEnd = '' +
    `  </body>
     </html>`

  const htmlText = !fullHtml ? result : htmlStart + result + htmlEnd

  return [htmlText, metadata]
}

export function defaultPluginOptions() {
  return {
    langCode: defaultLanguageCode(),
    customQuotes: undefined as undefined | [string, string, string, string],
    addToc: false,
  }
}

export type PluginOptions = ReturnType<typeof defaultPluginOptions>

export function parseMarkdown(text: string, parseOptions: Partial<PluginOptions>): [Token[], TaskMetadata] {
  const md = MarkdownIt().use(require("./markdown-it-bebras"), parseOptions)
  const env: any = {}
  const tokens = md.parse(text, env)
  const metadata: TaskMetadata = env.taskMetadata ?? defaultTaskMetadata()
  return [tokens, metadata]
}
