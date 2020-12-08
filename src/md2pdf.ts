import { PDFDocument } from 'pdf-lib'
import fs = require('fs-extra')
import path = require('path')
import puppeteer = require('puppeteer')
import md2html = require('./md2html')
import util = require("./util")
import patterns = require('./patterns')
import { PDFLoadingTask, PDFDocumentProxy, TextContentItem } from 'pdfjs-dist'
// @ts-ignore
import pdfjs = require("pdfjs-dist/es5/build/pdf.js")
import templates from './templates'
import { PdfBookmarkMetadata } from './json_schemas'
import { readFileSyncStrippingBom, TaskMetadata, toFileUrl } from './util'
import { exec } from 'child_process'
import hasbin = require("hasbin")

export async function runTerminal(mdFilePath: string, outPdfFilePath: string): Promise<void> {

    const [pdfData, metadata, sectionTitles] = await renderPdf(mdFilePath)
    fs.writeFileSync(outPdfFilePath, pdfData)

    const bookmarkMetadata = await generatePdfBookmarkMetadata(outPdfFilePath, sectionTitles, metadata)

    const outPdfmetaJsonFilePath = outPdfFilePath + "meta.json"
    fs.writeFileSync(outPdfmetaJsonFilePath, JSON.stringify(bookmarkMetadata, null, 2))

    let withBookmarks = false
    if (hasbin.sync("pdflatex")) {
        withBookmarks = await addPdfBookmarks(outPdfFilePath, bookmarkMetadata)
    }

    console.log(`${withBookmarks ? "Bookmarked " : ""}PDF written on ${outPdfFilePath}`)
    console.log(`PDF bookmark metadata written on ${outPdfmetaJsonFilePath}`)
}

function addPdfBookmarks(pdfFilePath: string, bookmarkMetadata: PdfBookmarkMetadata): Promise<boolean> {

    // provide only name as we're going to run pdflatex in the same dir
    const pdfFileNameOnly = path.basename(pdfFilePath)

    const texSource = templates.AddPdfBookmarks.render({
        pdfFiles: [{
            filepath: pdfFileNameOnly,
            bookmarkMetadata,
        }],
    })

    const texFile = util.siblingWithExtension(pdfFilePath, "_bookmarked.tex")
    fs.writeFileSync(texFile, texSource)

    const tempOutDir = util.siblingWithExtension(texFile, "")
    if (!fs.existsSync(tempOutDir)) {
        fs.mkdirSync(tempOutDir)
    }

    return new Promise<boolean>(function (resolve, reject) {
        const cmd = `pdflatex "--output-directory=${path.basename(tempOutDir)}" ${path.basename(texFile)}`
        exec(cmd, {
            cwd: path.dirname(pdfFilePath),
        }, function callback(error, stdout, stderr) {
            let didIt = false
            const texPdfFile = path.join(tempOutDir, path.basename(util.siblingWithExtension(texFile, ".pdf")))
            if (fs.existsSync(texPdfFile)) {
                fs.moveSync(texPdfFile, pdfFilePath, { overwrite: true })
                didIt = true
            }
            fs.removeSync(tempOutDir)
            fs.unlinkSync(texFile)
            resolve(didIt)
        })
    })
}

async function generatePdfBookmarkMetadata(pdfFilePath: string, sectionTitlesArray: string[], taskMetadata: TaskMetadata): Promise<PdfBookmarkMetadata> {

    const sectionPageNumbers: { [name: string]: number } = {}

    const sectionTitles = new Set<string>()
    sectionTitlesArray.forEach(c => sectionTitles.add(c))

    const doc = await (pdfjs.getDocument(pdfFilePath) as PDFLoadingTask<PDFDocumentProxy>).promise

    const numPages = doc.numPages

    async function loadPage(pageNum: number): Promise<void> {
        const page = await doc.getPage(pageNum)
        const content = await page.getTextContent()
        content.items.forEach(function (item: TextContentItem) {
            if (sectionTitles.has(item.str)) {
                sectionPageNumbers[item.str] = pageNum
            }
        })
    };

    for (let i = 1; i <= numPages; i++) {
        await loadPage(i)
    }

    const titleBookmark = {
        level: 0, page: 1,
        caption: `${taskMetadata.id} ${taskMetadata.title}`,
    }
    const sectionBookmarks = Object.entries(sectionPageNumbers).map(([caption, page]) => ({
        level: 1, page, caption,
    }))

    const bookmarks = [titleBookmark, ...sectionBookmarks]

    return { numPages, bookmarks }
}


async function renderPdf(mdFilePath: string): Promise<[Uint8Array, util.TaskMetadata, string[]]> {

    const textMd = readFileSyncStrippingBom(mdFilePath)

    const [textHtml, metadata] = md2html.renderMarkdown(textMd, true)

    const browser = await puppeteer.launch({ headless: true })
    const page = await browser.newPage()

    const fileUrl = toFileUrl(mdFilePath)
    await page.goto(fileUrl, { waitUntil: 'domcontentloaded' })

    await page.setContent(textHtml, { waitUntil: 'networkidle2' })

    const sectionTitles = await page.evaluate(_ => {
        const h2s = document.getElementsByTagName("H2")
        const sectionTitles = [] as string[]
        for (let i = 0; i < h2s.length; i++) {
            const section = h2s.item(i)
            if (section) {
                sectionTitles.push(section.innerHTML)
            }
        }
        return sectionTitles
    })

    const licence = patterns.genLicense(metadata)

    // TODO load that from CSS file?
    const baseHeaderFooterStyleParts: Array<[string, string]> = [
        ["font-family", "Helvetica, Arial, sans-serif"],
        ["font-size", "9px"],
        ["width", "100%"],
        ["margin", "0 45px"],
        ["position", "relative"],
        ["top", "-25px"],
        ["border-top", "1px solid lightgrey"],
        ["padding-top", "3px"],
        ["display", "flex"],
    ]

    const baseHeaderFooterStyle = baseHeaderFooterStyleParts.map(([name, value]) => `${name}: ${value} `).join(";")

    const footerTemplate = '' +
        `< div style = "${baseHeaderFooterStyle}" class="pdffooter" >
        <span style="flex:1 0 0; text-align: left" > ${ licence.shortCopyright()} </span>
            < span style = "flex:1 0 0; text-align: center; font-style:italic" > ${ metadata.id} ${metadata.title} </span>
                < span style = "flex:1 0 0; text-align: right" > Page < span class="pageNumber" > </span>/ < span class="totalPages" > </span>
                    < /div>`

    const pdfData = await page.pdf({
        format: 'A4',
        displayHeaderFooter: true,
        printBackground: true,
        headerTemplate: '<div/>',
        footerTemplate,
    })

    await browser.close()


    const doc = await PDFDocument.load(pdfData, {
        updateMetadata: false,
    })

    const pdfTitle = `${metadata.id} ${metadata.title}`
    doc.setTitle(pdfTitle)
    doc.setSubject(pdfTitle)
    doc.setCreator('Bebras Markdown Stack')
    doc.setProducer('Chromium via Puppeteer and the ‘pdf-lib’ package')

    const authors = metadata.contributors.map(contribLine => {
        const match = patterns.contributor.exec(contribLine)
        return match ? match.groups.name : contribLine
    })
    if (authors.length !== 0) {
        doc.setAuthor(authors.join(", "))
    }

    const keywords = metadata.keywords.map(kwLine => {
        const match = patterns.keyword.exec(kwLine)
        return match ? match.groups.keyword : kwLine
    })
    if (keywords.length !== 0) {
        doc.setKeywords([keywords.join(", ")])
    }
    // doc.setLanguage();

    const pdfBytes = await doc.save()

    return [pdfBytes, metadata, sectionTitles]

};