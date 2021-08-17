import * as fs from 'fs'
import MarkdownIt = require('markdown-it')
import Token = require('markdown-it/lib/token')

import { defaultTaskMetadata, readFileStrippingBom, TaskMetadata } from './util'
import { defaultLanguageCode } from './codes'

export async function convertTask_html(taskFile: string, outputFile: string): Promise<string> {
  const mdText = await readFileStrippingBom(taskFile)
  const [htmlText, metadata] = renderMarkdown(mdText, true)
  const r = await fs.promises.writeFile(outputFile, htmlText)
  console.log(`Output written on ${outputFile}`)
  return outputFile
}

export function renderMarkdown(text: string, fullHtml: boolean): [string, TaskMetadata] {
  const md = MarkdownIt().use(require("./convert_html_markdownit").plugin)

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
        <link href="https://gitcdn.link/repo/jppellet/bebras/main/static/bebrasmdstyle.css" rel="stylesheet" />
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

export function parseMarkdown(text: string, parseOptions?: Partial<PluginOptions>): [Token[], TaskMetadata] {
  const options = {...defaultPluginOptions(), ...parseOptions}
  const md = MarkdownIt().use(require("./convert_html_markdownit").plugin, options)
  const env: any = {}
  const tokens = md.parse(text, env)
  const metadata: TaskMetadata = env.taskMetadata ?? defaultTaskMetadata()
  return [tokens, metadata]
}
