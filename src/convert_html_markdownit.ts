import MarkdownIt = require("markdown-it")
import Token = require("markdown-it/lib/token")
import Renderer = require("markdown-it/lib/renderer")
import StateCore = require("markdown-it/lib/rules_core/state_core")
import katex = require("katex")

const slugify: (s: string) => string = require('slugify')

import * as yaml from 'js-yaml'
import * as path from 'path'

import { isUndefined } from "lodash"
import { normalizeRawMetadataToStandardYaml, postYamlLoadObjectCorrections } from "./check"
import { defaultLanguageCode } from "./codes"
import { CssStylesheet, defaultPluginOptions, PluginOptions } from "./convert_html"
import { getImageSize } from "./img_cache"
import * as patterns from './patterns'
import { isRecord, isString, parseLanguageCodeFromTaskPath, TaskMetadata } from "./util"
import _ = require("lodash")

import * as markdownItAnchor from "markdown-it-anchor"
import * as markdownItTocDoneRight from "markdown-it-toc-done-right"

export type PluginContext = {
  taskFile: string
  basePath: string
  setOptionsFromMetadata: boolean
}

export function plugin(getCurrentPluginContext: () => PluginContext) {
  return (md: MarkdownIt, _parseOptions: any) => {


    // console.log("custom options", _parseOptions)
    const pluginOptions: PluginOptions = { ...defaultPluginOptions(), ..._parseOptions }
    // console.log("all options", pluginOptions)

    // init plugins we need
    md = md
      .use(require("markdown-it-sub"))
      .use(require("markdown-it-sup"))
      .use(require('markdown-it-inline-comments'))

      // see https://www.npmjs.com/package/markdown-it-multimd-table
      .use(require("markdown-it-multimd-table-ext"), {
        multiline: true,
        rowspan: true,
        headerless: true,
      })

      // see https://github.com/goessner/markdown-it-texmath
      .use(require("markdown-it-texmath"), {
        engine: katex,
        delimiters: 'dollars',
        katexOptions: {
          // https://katex.org/docs/options.html
          fleqn: true,
        },
      })

    if (pluginOptions.fullHtml) {
      function usePlugin(plugin: any, opts?: any) {
        if ("default" in plugin) {
          plugin = plugin.default
        }
        md = md.use(plugin, opts)
      }
      usePlugin(markdownItAnchor)
      usePlugin(markdownItTocDoneRight)
    }

    const customContainerPlugin = require('markdown-it-container')
    md = md
      .use(customContainerPlugin, "center")
      .use(customContainerPlugin, "clear")
      .use(customContainerPlugin, "indent")
      .use(customContainerPlugin, "nobreak")
      .use(customContainerPlugin, "comment")
      .use(customContainerPlugin, "fullwidth")


    const quotesByLang: Record<string, [string, string, string, string]> = {
      eng: ['“', '”', '‘', '’'],
      fra: ['«\u202F', '\u202F»', '“', '”'],
      deu: ['«', '»', '“', '”'],
      ita: ['«', '»', '“', '”'],
    }

    const quotes = pluginOptions.customQuotes ?? quotesByLang[pluginOptions.langCode] ?? quotesByLang.eng
    // console.log("Using quotes: " + quotes + " for lang " + pluginOptions.langCode)

    // ensure options
    md.set({
      html: false,             // Disable HTML tags in source
      xhtmlOut: false,         // Don't use '/' to close single tags (<br />)
      breaks: false,           // Convert newlines in paragraphs into <br>
      langPrefix: 'language-', // CSS language prefix for fenced blocks
      linkify: true,           // Autoconvert URL-like text to links

      // Enable some language-neutral replacement + quotes beautification
      typographer: true,

      // Double + single quotes replacement pairs, when typographer enabled
      quotes,
    })


    type MdGeneratorFunction = (metadata: TaskMetadata) => string
    type HtmlGeneratorFunction = (metadata: TaskMetadata) => string


    const MdGeneratorTemplates: Record<string, MdGeneratorFunction> = {

      "title": (metadata: TaskMetadata) => {
        const parsedId = TaskMetadata.parseId(metadata.id)
        const [id, suffix] = parsedId ? [parsedId.id_plain, parsedId.usage_year ? ` (for ${parsedId.usage_year})` : ""] : [metadata.id, ""]
        return `# ${id} ${metadata.title}${suffix}`
      },

      // TODO remove this and load keywords from Markdown instead
      // "keywords": (metadata: TaskMetadata) => {
      //   const sectionBody = metadata.keywords.map(k => ` * ${k.replace(patterns.webUrl, "<$&>").replace(/ - /, ": ")}`).join("\n")
      //   return `## Keywords and Websites\n\n${sectionBody}`
      // },

      "contributors": (metadata: TaskMetadata) => {
        if (!pluginOptions.fullHtml) {
          return ""
        }

        const sectionBody = metadata.contributors.map(c => ` * ${c.replace(patterns.email, "<$&>")}`).join("\n")
        return `## Contributors\n\n${sectionBody}`
      },

      "support_files": (metadata: TaskMetadata) => {
        if (!pluginOptions.fullHtml) {
          return ""
        }

        const sectionBody = metadata.support_files.map(f => ` * ${f}`).join("\n")
        return `## Support Files\n\n${sectionBody}`
      },

      "license": (metadata: TaskMetadata) => {
        if (!pluginOptions.fullHtml) {
          return ""
        }

        const sectionBody = "{{license_body}}"
        return `## License\n\n${sectionBody}`
      },

    }


    const HtmlGeneratorTemplates: Record<string, HtmlGeneratorFunction> = {

      "license_body": (metadata: TaskMetadata) => {
        const license = patterns.genLicense(metadata)
        return "" +
          `<p>
            <div class="bebras-license">
              <div class="bebras-license-image">
                <a href="${license.url}"><img alt="license" title="${license.titleShort}" src="${license.imageUrl}"/></a>
              </div>
              <div class="bebras-license-text">
                ${license.fullCopyright()} <a href="${license.url}">${license.url}</a>
              </div>
            </div>
          </p>`
      },

      "header": (metadata: TaskMetadata) => {

        const ageCategories = patterns.ageCategories

        const ageRowCells =
          (Object.keys(ageCategories) as Array<keyof typeof ageCategories>).map(catName => {
            const catFieldName = ageCategories[catName]
            let catValue: string = metadata.ages[catFieldName] || "--"
            if (catValue.startsWith("--")) {
              catValue = "—"
            }
            return `<div class="bebras-age bebras-header-cell"><span class="bebras-header-caption">${catName}</span><span class="bebras-header-value">${catValue}</span></div>`
          }).join("")

        const answerType = `<span class="bebras-header-caption">Answer Type</span><span class="bebras-header-value">${metadata.answer_type}</span>`

        let relatedTaskRaw = metadata.equivalent_tasks
        let relatedTaskIDs: string[] = []
        if (!isUndefined(relatedTaskRaw)) {
          if (isString(relatedTaskRaw)) {
            relatedTaskIDs = relatedTaskRaw.split(",").map(s => s.trim())
          } else if (_.isArray(relatedTaskRaw)) {
            relatedTaskIDs = relatedTaskRaw
          }
        }
        const relatedTasks = `<span class="bebras-header-caption">Equivalent Tasks</span><span class="bebras-header-value">${relatedTaskIDs.length === 0 ? "—" : relatedTaskIDs.join(", ")}</span>`

        const checkedBox = `☒`
        const uncheckedBox = `☐`

        function catToRow(catName: string, taskValues: string[]) {
          const isRelated = taskValues.includes(catName)
          const catChecked = isRelated ? checkedBox : uncheckedBox
          return `${catChecked} ${catName}`
        }

        function makeCategoryCells(title: string, allValues: readonly string[], taskValues: string[]) {
          const numCat1 = Math.floor(allValues.length / 2)

          let catCell1 = `<div class="bebras-categories-cell"><span class="bebras-header-caption">${title}</span>`
          for (let i = 0; i < numCat1; i++) {
            catCell1 += `<span class="bebras-header-value">${catToRow(allValues[i], taskValues)}</span>`
          }
          catCell1 += `</div>`

          let catCell2 = `<div class="bebras-categories-cell">`
          for (let i = numCat1; i < allValues.length; i++) {
            catCell2 += `<span class="bebras-header-value">${catToRow(allValues[i], taskValues)}</span>`
          }
          catCell2 += `</div>`

          return [catCell1, catCell2]
        }

        const [csAreaCell1, csAreaCell2] = makeCategoryCells("Computer Science Areas", patterns.categories.map(c => c.name), metadata.categories.map(c => c.name))
        const [skillsCell1, skillsCell2] = makeCategoryCells("Computational Thinking Skills", patterns.ctSkills, metadata.computational_thinking_skills)


        // TODO CTSKILLS

        const keywords = metadata.keywords.map(kwLine => {
          const match = patterns.keyword.exec(kwLine)
          return match ? match.groups.keyword : kwLine
        })
        const keywordsStr = keywords.length === 0 ? "—" : keywords.join(", ")
        const keywordsCell = '' +
          `<div class="bebras-keywords-caption">
             <span class="bebras-header-caption">Keywords</span>
           </div>
           <div class="bebras-keywords-list">${keywordsStr}</div>`

        //  return '' +
        //  `<div class="bebras-header">
        //    <div class="bebras-ages">${ageRowCells}</div>
        //    <div class="bebras-answertype bebras-header-cell">${answerType}</div>
        //    <div class="bebras-categories bebras-header-cell">${catCell1}${catCell2}</div>
        //    <div class="bebras-keywords bebras-header-cell">${keywordsCell}</div>
        //   </div>`

        const style =
          isUndefined(CssStylesheet)
            ? "" // link included above
            : `<style>${CssStylesheet}</style>`


        return '' + // version without keywords for now, TODO
          `
          <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex/dist/katex.min.css">
          <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/markdown-it-texmath/css/texmath.min.css">
          ${style}
        
             <div class="bebras-header">
              <div class="bebras-ages">${ageRowCells}</div>
              <div class="bebras-answertype bebras-header-cell">${answerType}</div>
              <div class="bebras-categories bebras-header-cell">${csAreaCell1}${csAreaCell2}</div>
              <!-- div class="bebras-categories bebras-header-cell">${skillsCell1}${skillsCell2}</div -->
              <div class="bebras-relatedtasks bebras-header-cell">${relatedTasks}</div>
            </div>`
      },
    }

    type MdTemplateName = keyof typeof MdGeneratorTemplates
    type HtmlTemplateName = keyof typeof HtmlGeneratorTemplates

    type TemplateName = MdTemplateName | HtmlTemplateName | "table_of_contents"


    let basePath: string
    let ctx: PluginContext
    let taskMetadata: TaskMetadata

    md.core.ruler.before('block', 'bebras_metadata', (state: StateCore) => {
      // check front matter
      const fmStartMarkerLF = "---\n"
      const fmStartMarkerCRLF = "---\r\n"
      let fmStartMarker: string | undefined = undefined
      let newline = "\n"

      if (state.src.startsWith(fmStartMarkerLF)) {
        fmStartMarker = fmStartMarkerLF
        newline = "\n"
      } else if (state.src.startsWith(fmStartMarkerCRLF)) {
        fmStartMarker = fmStartMarkerCRLF
        newline = "\r\n"
      }

      ctx = getCurrentPluginContext()
      // console.log(ctx)
      basePath = ctx.basePath

      if (fmStartMarker) {
        const fmEndMarker = `${newline}---${newline}`
        const fmEnd = state.src.indexOf(fmEndMarker, fmStartMarker.length)
        if (fmEnd >= 0) {
          // parse front matter as YAML
          const fmStr = normalizeRawMetadataToStandardYaml(state.src.slice(0, fmEnd))
          let parsedMetadataFields: unknown
          try {
            parsedMetadataFields = yaml.load(fmStr)
          } catch {
            console.log("Error parsing metadata as YAML")
          }
          if (parsedMetadataFields && isRecord(parsedMetadataFields)) {
            postYamlLoadObjectCorrections(parsedMetadataFields)
            taskMetadata = TaskMetadata.validate(parsedMetadataFields, ctx.taskFile).fold(a => a, err => {
              console.log("Error parsing metadata: " + err)
              return TaskMetadata.defaultValue(ctx.taskFile)
            })
          } else {
            console.log("Error parsing metadata: " + JSON.stringify(parsedMetadataFields))
            taskMetadata = TaskMetadata.defaultValue(ctx.taskFile)
          }
          state.src = state.src.slice(fmEnd + fmEndMarker.length)
        }
      } else {
        console.log("No front matter found for file " + ctx.taskFile)
        taskMetadata = TaskMetadata.defaultValue(ctx.taskFile)
      }

      if (ctx.setOptionsFromMetadata) {
        const lang = parseLanguageCodeFromTaskPath(ctx.taskFile)
        md.set({ typographer: true, quotes: quotesByLang[lang ?? defaultLanguageCode()] ?? quotesByLang.eng })
        // console.log("set quotes to " + lang)
        // console.log(md.options)
      }
      state.env.taskMetadata = taskMetadata
      state.env.basePath = basePath

      return true
    })

    md.core.ruler.before('block', 'bebras_md_insert_metadata', (state: StateCore) => {
      if (!pluginOptions.fullHtml) {
        return false
      }

      const sep = "\n\n"
      function mkSections(names: TemplateName[]) {
        return sep + names.map(n => `{{${n}}}`).join(sep) + sep
      }

      const prologueSections: TemplateName[] = ["title", "header"]
      if (pluginOptions.addToc) {
        prologueSections.push("table_of_contents")
      }

      // TODO remove, no need to insert keywords
      // const insertKeywordsAfterSection = "Wording and Phrases"
      // const secMarker = `## ${insertKeywordsAfterSection}`
      // state.src =
      //   mkSections(prologueSections) +
      //   state.src.replace(secMarker, mkSections(["keywords"]) + `\n\n${secMarker}`) +
      //   mkSections(["contributors", "support_files", "license"])

      state.src =
        mkSections(prologueSections) +
        state.src +
        mkSections(["contributors", "support_files", "license"])

      return true
    })

    const templatePattern = "{{([a-zA-Z0-9_]+)}}"

    md.core.ruler.before('block', 'bebras_md_expand', (state: StateCore) => {
      const templateRegExp = new RegExp(templatePattern, 'g')
      const newSrcParts = [] as string[]

      let match: RegExpExecArray | null
      let lastMatchEnd = -1
      function flushPartTo(end: number) {
        const newPart = state.src.slice(lastMatchEnd + 1, end)
        if (newPart !== '') {
          newSrcParts.push(newPart)
        }
      }

      while ((match = templateRegExp.exec(state.src)) !== null) {
        const templateName = match[1] as MdTemplateName

        if (typeof MdGeneratorTemplates[templateName] !== "function") {
          continue
        }

        flushPartTo(match.index)
        lastMatchEnd = match.index + match[0].length
        templateRegExp.lastIndex = lastMatchEnd + 1

        newSrcParts.push(MdGeneratorTemplates[templateName](taskMetadata))
      }
      flushPartTo(state.src.length)

      state.src = newSrcParts.join("")

      return true
    })


    md.core.ruler.after('block', 'bebras_html_expand', (state: StateCore) => {
      if (!pluginOptions.fullHtml) {
        return false
      }

      const templateRegExp = new RegExp('^' + templatePattern + '$', 'i')


      const tokensIn = state.tokens
      const tokensOut = [] as Token[]
      let sectionOpen = false

      tokensOut.push(new state.Token('main_open', 'div', 1))

      for (let i = 0; i < tokensIn.length; i++) {
        let match: RegExpExecArray | null
        let templateName: string

        const type = tokensIn[i].type
        if (
          type === "paragraph_open" &&
          i < tokensIn.length - 2 &&
          tokensIn[i + 1].type === "inline" &&
          tokensIn[i + 2].type === "paragraph_close" &&
          (match = templateRegExp.exec(tokensIn[i + 1].content)) !== null &&
          typeof HtmlGeneratorTemplates[(templateName = match[1] as HtmlTemplateName)] === "function"
        ) {
          tokensIn[i + 1].type = "bebras_html_expand"
          tokensIn[i + 1].meta = templateName
          tokensOut.push(tokensIn[i + 1])
          i += 2

        } else if (type === "heading_close") {
          const headingName = tokensIn[i - 1].content
          tokensOut.push(tokensIn[i])
          const newToken = new state.Token('secbody_open', 'div', 1)
          newToken.info = headingName
          const level = parseInt(tokensIn[i].tag.slice(1))
          if (level >= 2) {
            let specificClass = ``
            if (i > 0 && tokensIn[i - 1].type === "inline") {
              specificClass = ` bebras-sectionbody-${slugify(headingName.toLowerCase())}`
            }
            newToken.attrPush(["class", `bebras-sectionbody-${level}${specificClass}`])
          }
          tokensOut.push(newToken)
          sectionOpen = true

        } else if (type === "heading_open") {
          if (sectionOpen) {
            tokensOut.push(new state.Token('secbody_close', 'div', -1))
            tokensOut.push(new state.Token('seccontainer_close', 'div', -1))
            sectionOpen = false
          }
          const headingName = tokensIn[i + 1].content
          const newToken = new state.Token('seccontainer_open', 'div', 1)
          newToken.info = headingName
          const level = parseInt(tokensIn[i].tag.slice(1))
          if (level >= 2) {
            let specificClass = ``
            if (i < tokensIn.length - 1 && tokensIn[i + 1].type === "inline") {
              specificClass = ` bebras-sectioncontainer-${slugify(headingName.toLowerCase())}`
            }
            newToken.attrPush(["class", `bebras-sectioncontainer-${level}${specificClass}`])
          }
          tokensOut.push(newToken)

          tokensOut.push(tokensIn[i])

        } else {
          tokensOut.push(tokensIn[i])
        }
      }

      if (sectionOpen) {
        const newToken = new state.Token('secbody_close', 'div', -1)
        tokensOut.push(newToken)
      }

      tokensOut.push(new state.Token('main_close', 'div', -1))

      state.tokens = tokensOut
      return true
    })



    const RARE_RE = /\+-|\.\.|\?\?\?\?|!!!!|,,|--|\-[0-9]/

    // disable the replacements of (c) by ©, etc. while keeping others
    function replace_rare(inlineTokens: Token[]) {
      let inside_autolink = 0
      for (let i = inlineTokens.length - 1; i >= 0; i--) {
        const token = inlineTokens[i]

        if (token.type === 'text' && !inside_autolink) {
          if (RARE_RE.test(token.content)) {
            // const before = token.content
            token.content = token.content
              // .., ..., ....... -> …
              .replace(/\.{2,}/g, '…')
              // em-dash
              // eslint-disable-next-line prefer-named-capture-group
              .replace(/(^|[^-])---(?=[^-]|$)/mg, '$1\u2014')
              // en-dash
              // eslint-disable-next-line prefer-named-capture-group
              .replace(/(^|\s)--(?=\s|$)/mg, '$1\u2013')
              // en-dash as minus
              // eslint-disable-next-line prefer-named-capture-group
              .replace(/(\s)\-([0-9]+)(?=\s|$)/mg, '$1\u2013$2')
              // eslint-disable-next-line prefer-named-capture-group
              .replace(/(^|[^-\s])--(?=[^-\s]|$)/mg, '$1\u2013')
            // const after = token.content
            // if (before !== after) {
            //   console.log("BEFORE: " + before)
            //   console.log("AFTER: " + after)
            //   console.log("----")
            // }
          }
        }

        if (token.type === 'link_open' && token.info === 'auto') {
          inside_autolink--
        }

        if (token.type === 'link_close' && token.info === 'auto') {
          inside_autolink++
        }
      }
    }

    md.core.ruler.at('replacements', (state: StateCore) => {
      for (let blockIndex = state.tokens.length - 1; blockIndex >= 0; blockIndex--) {
        if (state.tokens[blockIndex].type !== 'inline') { continue }

        if (RARE_RE.test(state.tokens[blockIndex].content)) {
          replace_rare(state.tokens[blockIndex].children!)
        }
      }
      return true
    })

    function headingName(tokens: Token[], idx: number) {
      if (idx < tokens.length - 1 && tokens[idx + 1].type === "inline") {
        return tokens[idx + 1].content
      }
      return ""
    }

    if (!pluginOptions.fullHtml) {
      md.core.ruler.after('bebras_html_expand', "section_filter", (state: StateCore) => {
        // walk through all tokens and remove the content not in the kept sections
        function shouldKeepSection(title: string) {
          const shouldKeep =
            title === "Body" ||
            title.startsWith("Question") ||
            title.startsWith("Answer Options") ||
            title.startsWith("Answer Explanation") ||
            title.startsWith("This is")
          // console.log("should keep " + title + " ? " + shouldKeep)
          return shouldKeep
        }

        const newTokens: Token[] = []
        let isSkipping = false
        let skippingLevel = -1
        for (let i = 0; i < state.tokens.length; i++) {
          const token = state.tokens[i]
          const isHeading = token.type === "heading_open"

          if (isSkipping && isHeading && parseInt(token.tag.slice(1)) <= skippingLevel!) {
            // stop skipping
            // console.log("stopped skipping at level " + skippingLevel + " becasue of new sectio " + headingName(state.tokens, i))
            isSkipping = false
          }

          if (!isSkipping && isHeading && !shouldKeepSection(headingName(state.tokens, i))) {
            // start skipping
            isSkipping = true
            skippingLevel = parseInt(token.tag.slice(1))
            // console.log("skipping at level " + skippingLevel + " for " + headingName(state.tokens, i))
          }

          if (!isSkipping) {
            newTokens.push(token)
          }

        }

        state.tokens = newTokens

        return true
      })
    }

    md.block.ruler.after('fence', 'raw', function fence(state, startLine, endLine, silent) {
      const OpenMarker = 0x3C/* < */
      const CloseMarker = 0x3E/* > */

      // if it's indented more than 3 spaces, it should be a code block
      if (state.sCount[startLine] - state.blkIndent >= 4) { return false }

      let pos = state.bMarks[startLine] + state.tShift[startLine]
      let max = state.eMarks[startLine]
      if (pos + 3 > max) { return false }

      if (state.src.charCodeAt(pos) !== OpenMarker) {
        return false
      }

      // scan marker length
      let mem = pos
      pos = state.skipChars(pos, OpenMarker)

      let len = pos - mem

      if (len < 3) { return false }

      const param = state.src.slice(pos, max).trim()
      let haveEndMarker = false

      // Since start is found, we can report success here in validation mode
      if (silent) { return true }

      // search end of block
      let nextLine = startLine

      for (; ;) {
        nextLine++
        if (nextLine >= endLine) {
          // unclosed block should be autoclosed by end of document.
          // also block seems to be autoclosed by end of parent
          break
        }

        pos = mem = state.bMarks[nextLine] + state.tShift[nextLine]
        max = state.eMarks[nextLine]

        if (pos < max && state.sCount[nextLine] < state.blkIndent) {
          // non-empty line with negative indent should stop the list:
          // - <<<
          //  test
          break
        }

        if (state.src.charCodeAt(pos) !== CloseMarker) { continue }

        if (state.sCount[nextLine] - state.blkIndent >= 4) {
          // closing fence should be indented less than 4 spaces
          continue
        }

        pos = state.skipChars(pos, CloseMarker)

        // closing code fence must be at least as long as the opening one
        if (pos - mem < len) { continue }

        // make sure tail has spaces only
        pos = state.skipSpaces(pos)

        if (pos < max) { continue }

        haveEndMarker = true
        // found!
        break
      }

      // If a fence has heading spaces, they should be removed from its inner block
      len = state.sCount[startLine]

      state.line = nextLine + (haveEndMarker ? 1 : 0)

      const token = state.push('raw', 'pre', 0)
      token.info = param
      token.content = state.getLines(startLine + 1, nextLine, len, true)
      token.map = [startLine, state.line]

      return true
    }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })

    md.renderer.rules.raw = (tokens: Token[], idx: number, options: MarkdownIt.Options, env: any, self: Renderer) => {
      const token = tokens[idx]
      // TODO add rule that you can write:
      //   <<<md-notex
      //   Some **Markdown** content here
      //   >>>
      // ... and this gets parsed as Markdown for output formats other than tex. Or:
      //   <<<md-html
      //   Some **Markdown** content here
      //   >>>
      // ... and this gets parsed as Markdown for output formats HTML only.
      if (token.info === "html") {
        return token.content
      } else {
        return ""
      }
    }

    const defaultImageRenderer = md.renderer.rules.image!
    md.renderer.rules.image = (tokens: Token[], idx: number, options: MarkdownIt.Options, env: any, self: Renderer) => {
      const token = tokens[idx]

      const imgScale = taskMetadata?.settings?.default_image_scale

      if (tokens.length === 1 && pluginOptions.fullHtml) {
        // this is the only image in a block
        token.attrJoin("class", "only-img-in-p")
      }

      let styles = [] as string[]

      function addStyle(name: string, value: string) {
        styles.push(`${name}:${value}`)
      }

      function addStylePx(name: string, decimalValue: string) {
        addStyle(name, `${decimalValue}px`)
      }

      let title, match
      if ((title = token.attrGet("title")) && (match = patterns.imageOptions.exec(title))) {

        const newTitle = title.replace(patterns.imageOptions, "")
        token.attrSet("title", newTitle)

        let value

        type GroupName = patterns.GroupNameOf<typeof patterns.imageOptions>

        const parserElems: Array<[GroupName, string, (n: string, v: string) => void]> = [
          ["width_abs", "width", addStylePx],
          ["width_rel", "width", addStyle],
          ["width_min", "min-width", addStylePx],
          ["width_max", "max-width", addStylePx],
          ["height_abs", "height", addStylePx],
        ]

        for (const [groupName, cssName, doAddStyle] of parserElems) {
          if (value = match.groups[groupName]) {
            doAddStyle(cssName, value)
          }
        }

        if (value = match.groups.placement) {
          if (value === "left" || value === "right") {
            addStyle("float", value)
          }
        }

        if (value = match.groups.placement_args) {
          addStyle("position", "relative")
          addStyle("bottom", value)
        }
      }

      if (!isUndefined(imgScale) && isUndefined(_.find(styles, s => s.startsWith("width:")))) {
        // if no width specified and we have an img scale, add its width
        const href = token.attrGet("src")
        if (href) {
          const imgPath = href.startsWith("/") ? href : path.join(basePath, href)
          const nativeWidth = getImageSize(imgPath)
          if (nativeWidth !== 0) {
            const finalWidth = Math.floor(nativeWidth * imgScale)
            addStylePx("width", String(finalWidth))
          }
        }
      }

      if (styles.length !== 0) {
        const style = styles.join("; ")
        token.attrPush(["style", style])
      }

      const altText = token.attrGet("alt")
      if ((altText === null || altText.length === 0) && (title = token.attrGet("title"))) {
        token.attrSet("alt", title)
      }

      return defaultImageRenderer(tokens, idx, options, env, self)
    }

    md.renderer.rules.bebras_html_expand = (tokens, idx) => {
      const templateName = tokens[idx].meta as HtmlTemplateName
      return HtmlGeneratorTemplates[templateName](taskMetadata)
    }


    md.renderer.rules.main_open = (tokens, idx) => {

      const metadata = taskMetadata
      const pageHeader = ``
      const pageFooter = '' +
        `<span class="bebras-page-footer-taskid">${metadata.id}</span>
         <span class="bebras-page-footer-tasktitle">${metadata.title}</span>`

      return ""
      // return '' +
      //   `<div class="bebras-page-header">${pageHeader}</div>
      //    <div class="bebras-page-footer">${pageFooter}</div>
      //    <table>
      //      <thead>
      //        <tr><td class="bebras-layout-cell"><div class="bebras-page-header-space">&nbsp;</div></td></tr>
      //      </thead>
      //      <tbody>
      //        <tr><td class="bebras-layout-cell">`;
    }

    md.renderer.rules.main_close = (tokens, idx) => {
      return ""
      // return '' +
      //   `    </td></tr>
      //      </tbody>
      //      <tfoot>
      //        <tr><td class="bebras-layout-cell"><div class="bebras-page-footer-space">&nbsp;</div></td></tr>
      //      </tfoot>
      //    </table>`;
    }

    if (!pluginOptions.fullHtml) {
      // replace heading_open and heading_close with paragraph_open and paragraph_close
      md.renderer.rules.heading_open = (tokens, idx) => {
        let title = ""
        if (idx < tokens.length - 1 && tokens[idx + 1].type === "inline") {
          title = tokens[idx + 1].content
        }
        // console.log(tokens.slice(idx, idx + 10))
        // console.log("heading_open: " + title)

        return `\n\n<p style="clear:both;"><strong>`
      }
      md.renderer.rules.heading_close = (tokens, idx) => {
        return `</strong></p>\n\n`
      }
    }


  }

}

