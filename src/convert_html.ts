import * as path from 'path'
import MarkdownIt = require('markdown-it')
import Token = require('markdown-it/lib/token')

import { isUndefined } from 'lodash'
import { defaultLanguageCode, languageNameAndShortCodeByLongCode } from './codes'
import { plugin, PluginContext } from './convert_html_markdownit'
import { readFileStrippingBom, writeData } from './fsutil'
import { parseLanguageCodeFromTaskPath, TaskMetadata } from './util'

export async function convertTask_html(taskFile: string, outputFile: string): Promise<string | true> {
   return convertTask_html_impl(taskFile, outputFile, true)
}

export async function convertTask_html_impl(taskFile: string, output: string | true, fullHtml: boolean): Promise<string | true> {
   const mdText = await readFileStrippingBom(taskFile)
   const langCode = parseLanguageCodeFromTaskPath(taskFile)
   const [htmlText, metadata] = renderMarkdown(mdText, taskFile, path.dirname(taskFile), fullHtml, langCode)
   return writeData(htmlText, output, `${!fullHtml ? "Simple " : ""}HTML`)
}

function makeMdParser(taskFile: string, basePath: string, options: PluginOptions) {
   const context: PluginContext = { taskFile, basePath, setOptionsFromMetadata: false }
   const md = MarkdownIt().use(plugin(() => context), options)
   return md
}

export function renderMarkdown(text: string, taskFile: string, basePath: string, fullHtml: boolean, langCodeOpt: string | undefined): [string, TaskMetadata] {
   const langCode = langCodeOpt ?? defaultLanguageCode()
   const parseOptions = { ...defaultPluginOptions(), fullHtml, langCode }
   const md = makeMdParser(taskFile, basePath, parseOptions)
   const env: any = {}
   let result: string
   try {
      result = md.render(text, env)
   } catch (e) {
      console.error(`Error rendering Markdown in ${taskFile}: ${e}`)
      throw e
   }
   const metadata: TaskMetadata = env.taskMetadata ?? TaskMetadata.defaultValue(taskFile)

   const style =
      isUndefined(CssStylesheet)
         ? `<link href="https://gitcdn.link/repo/jppellet/bebras/main/static/bebrasmdstyle.css" rel="stylesheet" />`
         : "" // set later inline

   const langCodeShort = languageNameAndShortCodeByLongCode[langCode]?.[1] ?? "en"

   const htmlStart = '' +
      `<!DOCTYPE html>
     <html lang="${langCodeShort}">
       <head>
         <meta charset="utf-8">
         <meta name="viewport" content="width=device-width, initial-scale=1">
         <title>${metadata.id} ${metadata.title}</title>
         ${style}
        
       </head>
       <body>`

   const htmlEnd = '' +
      `  </body>
     </html>`

   const htmlText = !fullHtml ? result : htmlStart + result + htmlEnd

   return [htmlText.trimStart(), metadata]
}

export function defaultPluginOptions() {
   return {
      langCode: defaultLanguageCode(),
      customQuotes: undefined as undefined | [string, string, string, string],
      addToc: false,
      fullHtml: true,
   }
}

export type PluginOptions = ReturnType<typeof defaultPluginOptions>

export async function parseTask(taskFile: string, parseOptions: Partial<PluginOptions> = {}): Promise<[Token[], TaskMetadata, string]> {
   const mdText = await readFileStrippingBom(taskFile)
   return parseTaskMd(mdText, taskFile, parseOptions)
}

export async function parseTaskMd(mdText: string, taskFile: string, parseOptions: Partial<PluginOptions> = {}): Promise<[Token[], TaskMetadata, string]> {
   const langCode = parseLanguageCodeFromTaskPath(taskFile) ?? defaultLanguageCode()
   return [...parseMarkdown(mdText, taskFile, path.dirname(taskFile), { langCode, ...parseOptions }), langCode]
}

export function parseMarkdown(text: string, taskFile: string, basePath: string, parseOptions: Partial<PluginOptions>): [Token[], TaskMetadata] {
   const options = { ...defaultPluginOptions(), parseOptions }
   const md = makeMdParser(taskFile, basePath, options)
   const env: any = {}
   let tokens: Token[]
   try {
      tokens = md.parse(text, env)
   } catch (e) {
      console.error(`Error parsing Markdown in ${taskFile}: ${e}`)
      throw e
   }
   const metadata: TaskMetadata = env.taskMetadata ?? TaskMetadata.defaultValue(taskFile)
   return [tokens, metadata]
}

// TODO load from file!
export const CssStylesheet: string | undefined = `
/* 
* Minimal CSS Reset and Base Style
*/

html {
   box-sizing: border-box;
   /* background:#eee; */
   -webkit-text-size-adjust: 100%;
}
 
*, *:before, *:after {
 box-sizing: inherit;
}

body {
   font-family: Helvetica, Arial, sans-serif;
   font-size: 12pt;
   line-height: 140%;
   max-width: 750px;
   margin: auto;
   padding: 40px;
   /* background:white; */
   border-left: 1px solid lightgrey;
   border-right: 1px solid lightgrey;
}

h1 {
   position: -webkit-sticky;
   position: sticky;
   top: 0;
   /* background: white; */
   z-index: 10;
   backdrop-filter: blur(8px);

   margin: 0;
   padding: 15px 0;
   border-bottom: 1px solid lightgrey;
   font-size: 150%;
   font-weight: bold;
   text-align: center;
   page-break-after: avoid;
}

.bebras-sectionbody-1 {
   margin-top: -1px;
}

h2 {
   font-size: 120%;
   font-weight: bold;
   margin-top: 40px;
   padding-bottom: 5px;
   border-bottom: 1px solid lightgrey;
   clear: both;
   page-break-after: avoid;
}

p, ul, ol {
   margin: 10px 0;
}

li {
   margin-top: 5px;
}

img {
    max-width: unset;
    max-height: unset;
}

th,
td {
    padding: 5px 10px;
}

table > tbody > tr + tr > td {
    border-top: unset;
}

/* Center all paragraph-images by default */
img.only-img-in-p {
   display: block;
   margin: 10px auto;
}

.center {
   width: 100%;
   text-align: center;
}

.clear {
   clear: both;
}

.indent {
   margin-left: 30px;
}

.comment {
   padding-left: 10px;
   font-size: 90%;
   border-left: 2px solid lightgrey;
}

/* sub and sup rules to not disgracefully affect line-height */

sup {
   vertical-align: top;
   position: relative;
   top: -0.4em;
}

sub {
   vertical-align: bottom;
   position: relative;
   bottom: -0.4em;
}

@media only screen and (max-width: 600px) {

   body {
       padding: 20px;
   }

   ul, ol {
       padding-left: 20px;
   }

}


/*
* Print/PDF
*/

@page {
 margin: 60px 60px 80px;
}
 
@media only print {

   html {
       background: none;
   }

   body {
       background: none;
       border: none;
       padding: 0;
       max-width: unset;
   }

   .table-of-contents {
       display: none;
   }
}

.bebras-layout-cell {
   padding: 0;
}

/* .bebras-page-header, .bebras-page-header-space {
 display: none;
}

.bebras-page-footer,
.bebras-page-footer-space {
   margin-top: 10px;
   height: 30px;
}

.bebras-page-header,
.bebras-page-footer {
   left: 0;
   right: 0;
}

.bebras-page-header {
 position: fixed;
 top: 0;
}

.bebras-page-footer {
 position: fixed;
 bottom: 0;
 border-top: 0.5px solid lightgray;
 display: flex;
 font-size: 70%;
}

.bebras-page-footer-taskid {
   font-weight: bold;
}

.bebras-page-footer-tasktitle {
   margin-left: 0.8em;
   font-style: italic;
}


@media only screen {
   .bebras-page-header, .bebras-page-header-space,
.bebras-page-footer, .bebras-page-footer-space {
       display: none;
   }
} */



/* 
* Header
*/

.bebras-header {
   line-height: 100%;
   width: 100%;
   display: flex;
   flex-direction: column;
   align-items: stretch;
   font-size: 90%;
   border-collapse: collapse;
   padding: 1px 0 0 1px;
   margin-bottom: 20px;
}

.bebras-header-cell {
   padding: 5px;
   border: 1px solid #BBB;
   margin: -1px 0 0 -1px;
}

.bebras-ages {
   display: flex;
   justify-content: stretch;
}

.bebras-age {
   text-align: center;
   flex: auto;
   display: flex;
   flex-direction: column;
   align-items: center;
}

.bebras-header-caption {
   font-style: italic;
}

.bebras-header-caption::after {
   content: ': ';
}

.bebras-categories {
   display: flex;
   align-items: stretch;
}

.bebras-categories-cell {
   flex: auto;
   display: flex;
   flex-direction: column;
}

.bebras-keywords {
   display: flex;
}

.bebras-keywords-caption {
   padding-right: 0.5em;
}

.bebras-keywords-list {
   flex: auto;
}

.table-of-contents li {
   margin-top: 0;
}

@media only screen and (max-width: 600px) {

   .bebras-categories {
       flex-direction: column;
   }

   .bebras-ages {
       flex-wrap: wrap;
   }

   .bebras-age {
       flex-basis: 33%;
   }
}


/* 
* Main content
*/

.bebras-sectionbody-2 {
   margin-left: -17px;
   border-left: 4px solid;
   padding-left: 13px;
   page-break-before: avoid;
   border-left-color:rgba(128,128,128,0);
}

.bebras-sectionbody-2:hover {
   border-left-color:rgba(128,128,128,0.2);
}

.bebras-sectionbody-questionchallenge,
.bebras-sectionbody-questionchallenge-for-the-online-challenge,
.bebras-sectionbody-questionchallenge-for-the-brochures,
.bebras-sectionbody-interactivity-instructions {
   font-style: italic;
}

.bebras-sectionbody-questionchallenge em, .bebras-sectionbody-questionchallenge i,
.bebras-sectionbody-questionchallenge-for-the-online-challenge em, .bebras-sectionbody-questionchallenge-for-the-online-challenge i,
.bebras-sectionbody-questionchallenge-for-the-brochures em, .bebras-sectionbody-questionchallenge-for-the-brochures i,
.bebras-sectionbody-interactivity-instructions em, .bebras-sectionbody-interactivity-instructions i {
   font-style: normal;
}

.bebras-sectioncontainer-questionchallenge,
.bebras-sectioncontainer-answer-optionsinteractivity-description
.bebras-sectioncontainer-contributors,
.bebras-sectioncontainer-supportfiles,
.bebras-sectioncontainer-keywords-and-websites,
.bebras-sectioncontainer-wording-and-phrases {
   page-break-inside: avoid;
}


@media only screen and (max-width: 600px) {

   .bebras-sectionbody-2 {
       margin-left: -13px;
       padding-left: 9px;
   }

}


/* 
* Footer
*/

.bebras-license {
   display: flex;
   line-height: 100%;
}

.bebras-license-text {
   font-size: 90%;
   line-height: 100%;
   padding-left: 5px;
}

@media only screen and (max-width: 600px) {

   .bebras-license {
       flex-direction: column-reverse;
   }

   .bebras-license-text {
       padding-left: 0;
       padding-bottom: 10px;
   }

}
`
