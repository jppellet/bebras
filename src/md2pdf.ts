import { PDFDocument } from 'pdf-lib';
import fs = require('fs');
import puppeteer = require('puppeteer');
import md2html = require('./md2html');
import util = require("./util");
import path = require('path');
import patterns = require('./patterns');

export async function runTerminal(fileIn: string, fileOut: string) {
    const pdfData = await renderPdf(fileIn);
    fs.writeFileSync(fileOut, pdfData);
    console.log(`Output written on ${fileOut}`);
}

function toFileUrl(filepath: string): string {
    let pathName = path.resolve(filepath).replace(/\\/g, '/');

    // Windows drive letter must be prefixed with a slash
    if (pathName[0] !== '/') {
        pathName = '/' + pathName;
    }

    return encodeURI('file://' + pathName);
};


export async function renderPdf(filepath: string) {

    const textMd = fs.readFileSync(filepath, 'utf-8');

    const [textHtml, metadata] = md2html.renderMarkdown(textMd, true);

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(toFileUrl(filepath), { waitUntil: 'domcontentloaded' });

    await page.setContent(textHtml, { waitUntil: 'networkidle2' });

    const licence = patterns.genLicense(metadata);

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
    ];

    const baseHeaderFooterStyle = baseHeaderFooterStyleParts.map(([name, value]) => `${name}:${value}`).join(";");

    const footerTemplate = '' +
        `<div style="${baseHeaderFooterStyle}" class="pdffooter">
          <span style="flex:1 0 0; text-align: left">${licence.shortCopyright()}</span>
          <span style="flex:1 0 0; text-align: center; font-style:italic">${metadata.id} ${metadata.title}</span>
          <span style="flex:1 0 0; text-align: right">Page <span class="pageNumber"></span>/<span class="totalPages"></span>
         </div>`;

    const pdfData = await page.pdf({
        format: 'A4',
        displayHeaderFooter: true,
        printBackground: true,
        headerTemplate: '<div/>',
        footerTemplate
    });

    await browser.close();


    const doc = await PDFDocument.load(pdfData, {
        updateMetadata: false
    });

    const pdfTitle = `${metadata.id} ${metadata.title}`;
    doc.setTitle(pdfTitle);
    doc.setSubject(pdfTitle);
    doc.setCreator('Bebras Markdown Stack');
    doc.setProducer('Chromium via Puppeteer and the ‘pdf-lib’ package');

    const authors = metadata.contributors.map(contribLine => {
        const match = patterns.contributor.exec(contribLine);
        return match ? match.groups.name : contribLine;
    });
    if (authors.length !== 0) {
        doc.setAuthor(authors.join(", "));
    }

    const keywords = metadata.keywords.map(kwLine => {
        const match = patterns.keyword.exec(kwLine);
        return match ? match.groups.keyword : kwLine;
    });
    if (keywords.length !== 0) {
        doc.setKeywords([keywords.join(", ")]);
    }
    // doc.setLanguage();

    const pdfBytes = await doc.save();

    return pdfBytes;

};