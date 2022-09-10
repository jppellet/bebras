import { PDFDocument } from 'pdf-lib'
import * as fs from 'fs'
import path = require('path')
import puppeteer = require('puppeteer')
import md2html = require('./convert_html')
import util = require("./util")
import patterns = require('./patterns')

// import { PDFLoadingTask, PDFDocumentProxy, TextContentItem } from 'pdfjs-dist'
// // @ts-ignore
// import pdfjs = require("pdfjs-dist/es5/build/pdf.js")

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf'
// @ts-ignore
import PDFJSWorker from 'pdfjs-dist/legacy/build/pdf.worker.entry'
import { TextContent, TextItem } from 'pdfjs-dist/types/display/api'

import templates from './templates'
import { PdfBookmarkMetadata } from './json_schemas'
import { isBinaryAvailable, mkdirsOf, readFileStrippingBom, TaskMetadata, toFileUrl } from './util'
import { exec } from 'child_process'

pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJSWorker


export async function convertTask_pdf(taskFile: string, outputFile: string): Promise<string> {

    const [pdfData, metadata, sectionTitles] = await renderPdf(taskFile)

    // console.log("pdfData", pdfData)

    await mkdirsOf(outputFile)
    await fs.promises.writeFile(outputFile, pdfData)

    const bookmarkMetadata = await generatePdfBookmarkMetadata(outputFile, sectionTitles, metadata)

    const outPdfmetaJsonFilePath = outputFile + "meta.json"
    await fs.promises.writeFile(outPdfmetaJsonFilePath, JSON.stringify(bookmarkMetadata, null, 2))

    let withBookmarks = false

    if (await isBinaryAvailable("pdflatex")) {
        withBookmarks = await addPdfBookmarks(outputFile, bookmarkMetadata)
    }

    console.log(`${withBookmarks ? "Bookmarked " : ""}PDF written on ${outputFile}`)
    console.log(`PDF bookmark metadata written on ${outPdfmetaJsonFilePath}`)
    return outputFile
}

async function addPdfBookmarks(pdfFilePath: string, bookmarkMetadata: PdfBookmarkMetadata): Promise<boolean> {

    // provide only name as we're going to run pdflatex in the same dir
    const pdfFileNameOnly = path.basename(pdfFilePath)

    const texSource = (await templates.AddPdfBookmarks.render)({
        pdfFiles: [{
            filepath: pdfFileNameOnly,
            bookmarkMetadata,
        }],
    })

    const texFile = util.siblingWithExtension(pdfFilePath, "_bookmarked.tex")
    await fs.promises.writeFile(texFile, texSource)

    const tempOutDir = util.siblingWithExtension(texFile, "")
    if (!fs.existsSync(tempOutDir)) {
        await fs.promises.mkdir(tempOutDir)
    }

    return new Promise<boolean>(function (resolve, reject) {
        const cmd = `pdflatex "--output-directory=${path.basename(tempOutDir)}" ${path.basename(texFile)}`
        exec(cmd, {
            cwd: path.dirname(pdfFilePath),
        }, async function callback(error, stdout, stderr) {
            let didIt = false
            const texPdfFile = path.join(tempOutDir, path.basename(util.siblingWithExtension(texFile, ".pdf")))
            if (fs.existsSync(texPdfFile)) {
                await fs.promises.unlink(pdfFilePath)
                await fs.promises.rename(texPdfFile, pdfFilePath)
                didIt = true
            }
            // await fs.promises.rm(tempOutDir, { recursive: true, force: true }) // <- for newer nodes
            await fs.promises.rmdir(tempOutDir, { recursive: true })
            await fs.promises.unlink(texFile)
            resolve(didIt)
        })
    })
}

async function generatePdfBookmarkMetadata(pdfFilePath: string, sectionTitlesArray: string[], taskMetadata: TaskMetadata): Promise<PdfBookmarkMetadata> {

    const sectionPageNumbers: { [name: string]: number } = {}

    const sectionTitles = new Set<string>()
    sectionTitlesArray.forEach(c => sectionTitles.add(c))

    const doc = await pdfjsLib.getDocument(pdfFilePath).promise

    const numPages = doc.numPages

    async function loadPage(pageNum: number): Promise<void> {
        const page = await doc.getPage(pageNum)
        const content = await page.getTextContent();
        (content.items as TextItem[]).forEach(function (item) {
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

    const textMd = await readFileStrippingBom(mdFilePath)

    const [textHtml, metadata] = md2html.renderMarkdown(textMd, path.dirname(mdFilePath), true)

    const browser = await puppeteer.launch({ headless: true })
    const page = await browser.newPage()

    const fileUrl = toFileUrl(mdFilePath)
    await page.goto(fileUrl, { waitUntil: 'domcontentloaded' })

    await page.setContent(textHtml, { waitUntil: 'networkidle2' })

    const sectionTitles = await page.evaluate(_ => {
        // @ts-ignore
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
        `<div style = "${baseHeaderFooterStyle}" class="pdffooter">
        <span style="flex:1 0 0; text-align: left" > ${licence.shortCopyright()} </span>
            <span style="flex:1 0 0; text-align: center; font-style:italic" > ${metadata.id} ${metadata.title} </span>
                <span style="flex:1 0 0; text-align: right">Page <span class="pageNumber"></span>/<span class="totalPages"></span>
                    </div>`

    const pdfData = await page.pdf({
        format: 'a4',
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