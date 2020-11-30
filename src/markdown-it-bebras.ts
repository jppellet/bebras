import MarkdownIt = require("markdown-it")
import Token = require("markdown-it/lib/token")
import Renderer = require("markdown-it/lib/renderer")
import StateCore = require("markdown-it/lib/rules_core/state_core")

const slugify: (s: string) => string = require('slugify')

import * as yaml from 'js-yaml'

import * as patterns from './patterns'
import { TaskMetadata, defaultTaskMetadata } from "./util"


function bebrasPlugin(md: MarkdownIt, _options: any) {

  // init plugins we need
  md
    .use(require("markdown-it-sub"))
    .use(require("markdown-it-sup"))
    .use(require("markdown-it-texmath"), {
      engine: require('katex'),
    })
    .use(require("markdown-it-anchor"))
    .use(require("markdown-it-multimd-table"), {
      multiline: true,
      rowspan: true,
      headerless: true,
    }) // see https://www.npmjs.com/package/markdown-it-multimd-table
    .use(require("markdown-it-toc-done-right"), { level: 2, listType: "ul", placeholder: '{{table_of_contents}}' })

  const quotes = {
    eng: ['“', '”', '‘', '’'],
    fra: ['«\u202F', '\u202F»', '“', '”'],
    deu: ['„', '“', '‚', '‘'],
    ita: ['«', '»', '“', '”'],
  }

  // ensure options
  md.set({
    html: false,        // Disable HTML tags in source
    xhtmlOut: false,    // Don't use '/' to close single tags (<br />).
    breaks: false,      // Convert '\n' in paragraphs into <br>
    langPrefix: 'language-', // CSS language prefix for fenced blocks. Can be
    // useful for external highlighters.
    linkify: false,     // Autoconvert URL-like text to links

    // Enable some language-neutral replacement + quotes beautification
    typographer: true,

    // Double + single quotes replacement pairs, when typographer enabled,
    quotes: quotes.fra, // TODO set according to lang
  })

  const defaultOptions = {
    addToc: false,
  }

  type PluginOptions = typeof defaultOptions

  const options: PluginOptions = Object.assign({}, defaultOptions, _options)

  type MdGeneratorFunction = (metadata: TaskMetadata) => string
  type HtmlGeneratorFunction = (metadata: TaskMetadata) => string


  const MdGeneratorTemplates = {

    "title": (metadata: TaskMetadata) => {
      return `# ${metadata.id} ${metadata.title}`
    },

    // TODO remove this and load keywords from Markdown instead
    // "keywords": (metadata: TaskMetadata) => {
    //   const sectionBody = metadata.keywords.map(k => ` * ${k.replace(patterns.webUrl, "<$&>").replace(/ - /, ": ")}`).join("\n")
    //   return `## Keywords and Websites\n\n${sectionBody}`
    // },

    "contributors": (metadata: TaskMetadata) => {
      const sectionBody = metadata.contributors.map(c => ` * ${c.replace(patterns.email, "<$&>")}`).join("\n")
      return `## Contributors\n\n${sectionBody}`
    },

    "support_files": (metadata: TaskMetadata) => {
      const sectionBody = metadata.support_files.map(f => ` * ${f}`).join("\n")
      return `## Support Files\n\n${sectionBody}`
    },

    "license": (metadata: TaskMetadata) => {
      const sectionBody = "{{license_html}}"
      return `## License\n\n${sectionBody}`
    },

  }


  const HtmlGeneratorTemplates = {

    "license_html": (metadata: TaskMetadata) => {
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
      const categories = patterns.categories

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

      const numCat1 = Math.floor(categories.length / 2)

      const checkedBox = `☒`
      const uncheckedBox = `☐`

      function catToRow(catName: string) {
        const isRelated = metadata.categories.includes(catName)
        const catChecked = isRelated ? checkedBox : uncheckedBox
        return `${catChecked} ${catName}`
      }

      let catCell1 = `<div class="bebras-categories-cell"><span class="bebras-header-caption">Categories</span>`
      for (let i = 0; i < numCat1; i++) {
        catCell1 += `<span class="bebras-header-value">${catToRow(categories[i])}</span>`
      }
      catCell1 += `</div>`

      let catCell2 = `<div class="bebras-categories-cell">`
      for (let i = numCat1; i < categories.length; i++) {
        catCell2 += `<span class="bebras-header-value">${catToRow(categories[i])}</span>`
      }
      catCell2 += `</div>`

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

      return '' + // version without keywords for now, TODO
        `<div class="bebras-header">
            <div class="bebras-ages">${ageRowCells}</div>
            <div class="bebras-answertype bebras-header-cell">${answerType}</div>
            <div class="bebras-categories bebras-header-cell">${catCell1}${catCell2}</div>
           </div>`
    },
  }

  type MdTemplateName = keyof typeof MdGeneratorTemplates
  type HtmlTemplateName = keyof typeof HtmlGeneratorTemplates

  type TemplateName = MdTemplateName | HtmlTemplateName | "table_of_contents"


  let taskMetadata: TaskMetadata | undefined

  md.core.ruler.before('block', 'bebras_metadata', (state: StateCore) => {
    // check front matter
    let parsedMetadata: object | undefined
    const fmStartMarker = "---\n"
    const fmEndMarker = "\n---\n"
    if (state.src.startsWith(fmStartMarker)) {
      const fmEnd = state.src.indexOf(fmEndMarker, fmStartMarker.length)
      if (fmEnd >= 0) {
        // parse front matter as YAML
        const fmStr = state.src.slice(0, fmEnd)
        try {
          parsedMetadata = yaml.safeLoad(fmStr)
        } catch { }
        state.src = state.src.slice(fmEnd + fmEndMarker.length)
      }
    }

    taskMetadata = Object.assign({}, defaultTaskMetadata(), parsedMetadata)
    state.env.taskMetadata = taskMetadata

    return true
  })

  md.core.ruler.before('block', 'bebras_md_insert_metadata', (state: StateCore) => {
    const sep = "\n\n"
    function mkSections(names: TemplateName[]) {
      return sep + names.map(n => `{{${n}}}`).join(sep) + sep
    }

    const prologueSections: TemplateName[] = ["title", "header"]
    if (options.addToc) {
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

    taskMetadata = taskMetadata || defaultTaskMetadata()

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
        tokensOut.push(tokensIn[i])
        const newToken = new state.Token('secbody_open', 'div', 1)
        const level = parseInt(tokensIn[i].tag.slice(1))
        if (level >= 2) {
          let specificClass = ``
          if (i > 0 && tokensIn[i - 1].type === "inline") {
            specificClass = ` bebras-sectionbody-${slugify(tokensIn[i - 1].content.toLowerCase())}`
          }
          newToken.attrPush(["class", `bebras-sectionbody-${level}${specificClass}`])
          tokensOut.push(newToken)
        }
        sectionOpen = true

      } else if (type === "heading_open") {
        if (sectionOpen) {
          tokensOut.push(new state.Token('secbody_close', 'div', -1))
          tokensOut.push(new state.Token('seccontainer_close', 'div', -1))
          sectionOpen = false
        }
        const newToken = new state.Token('secbody_open', 'div', 1)
        const level = parseInt(tokensIn[i].tag.slice(1))
        if (level >= 2) {
          let specificClass = ``
          if (i < tokensIn.length - 1 && tokensIn[i + 1].type === "inline") {
            specificClass = ` bebras-sectioncontainer-${slugify(tokensIn[i + 1].content.toLowerCase())}`
          }
          newToken.attrPush(["class", `bebras-sectioncontainer-${level}${specificClass}`])
          tokensOut.push(newToken)
        }

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

    console.log(token)

    return true
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })

  md.renderer.rules.raw = (tokens: Token[], idx: number, options: MarkdownIt.Options, env: any, self: Renderer) => {
    const token = tokens[idx]
    if (token.info.length === 0 || token.info === "html") {
      return token.content
    } else {
      return ""
    }
  }

  const defaultImageRenderer = md.renderer.rules.image!
  md.renderer.rules.image = (tokens: Token[], idx: number, options: MarkdownIt.Options, env: any, self: Renderer) => {
    const token = tokens[idx]

    if (tokens.length === 1) {
      // this is the only image in a block
      token.attrJoin("class", "only-img-in-p")
    }

    let title, match
    if ((title = token.attrGet("title")) && (match = patterns.imageOptions.exec(title))) {

      const newTitle = title.replace(patterns.imageOptions, "")
      token.attrSet("title", newTitle)

      let value
      let styles = [] as string[]

      function addStyle(name: string, value: string) {
        styles.push(`${name}:${value}`)
      }

      function addStylePx(name: string, decimalValue: string) {
        addStyle(name, `${decimalValue}px`)
      }

      type GroupName = patterns.GroupNameOf<typeof patterns.imageOptions>

      const parserElems: Array<[GroupName, string, (n: string, v: string) => void]> = [
        ["width_abs", "width", addStylePx],
        ["width_rel", "width", addStyle],
        ["width_min", "min-width", addStylePx],
        ["width_max", "max-width", addStylePx],
        ["height_abs", "height", addStylePx],
        ["placement", "float", addStyle],
      ]

      for (const [groupName, cssName, doAddStyle] of parserElems) {
        if (value = match.groups[groupName]) {
          doAddStyle(cssName, value)
        }
      }

      if (styles.length !== 0) {
        const style = styles.join(";\n")
        token.attrPush(["style", style])
      }
    }
    return defaultImageRenderer(tokens, idx, options, env, self)
  }

  md.renderer.rules.bebras_html_expand = (tokens, idx) => {
    const templateName = tokens[idx].meta as HtmlTemplateName
    return HtmlGeneratorTemplates[templateName](taskMetadata || defaultTaskMetadata())
  }


  md.renderer.rules.main_open = (tokens, idx) => {

    const metadata = taskMetadata ?? defaultTaskMetadata()
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


}


export = bebrasPlugin