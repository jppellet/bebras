import { PDFDocument } from 'pdf-lib';
import fs = require('fs');
import puppeteer = require('puppeteer');
import md2html = require('./md2html');
import util = require("./util");

export async function runTerminal(fileIn: string, fileOut: string) {
    const pdfData = await renderPdf(fileIn);
    fs.writeFileSync(fileOut, pdfData);
    console.log(`Wrote ${fileOut}`);
}

export async function renderPdf(filepath: string) {

    const textMd = fs.readFileSync(filepath, 'utf-8');

    const [textHtml, metadata] = md2html.renderMarkdown(textMd, true);

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(`file:///Users/jpp/Desktop/bebrastasksupport/${filepath}`, { waitUntil: 'domcontentloaded' });

    await page.setContent(textHtml, { waitUntil: 'networkidle2' });

    const pdfData = await page.pdf({ format: 'A4' });

    await browser.close();


    const doc = await PDFDocument.load(pdfData, {
        updateMetadata: false
    });

    const pdfTitle = `${metadata.id} ${metadata.title}`;
    doc.setTitle(pdfTitle);
    doc.setSubject(pdfTitle);
    doc.setAuthor(metadata.contributors.join("; "));
    // doc.setKeywords();
    doc.setCreator('Bebras Markdown Stack');
    doc.setProducer('Chromium via Puppeteer and the ‘pdf-lib’ package');

    const pdfBytes = await doc.save();

    return pdfBytes;

};