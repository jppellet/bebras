"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertTask = void 0;
const pdf_lib_1 = require("pdf-lib");
const fs = require("fs-extra");
const path = require("path");
const puppeteer = require("puppeteer");
const md2html = require("./convert_html");
const util = require("./util");
const patterns = require("./patterns");
const pdfjs = require("pdfjs-dist/es5/build/pdf.js");
const templates_1 = require("./templates");
const util_1 = require("./util");
const child_process_1 = require("child_process");
const hasbin = require("hasbin");
function convertTask(taskFile, outputFile) {
    return __awaiter(this, void 0, void 0, function* () {
        const [pdfData, metadata, sectionTitles] = yield renderPdf(taskFile);
        fs.writeFileSync(outputFile, pdfData);
        const bookmarkMetadata = yield generatePdfBookmarkMetadata(outputFile, sectionTitles, metadata);
        const outPdfmetaJsonFilePath = outputFile + "meta.json";
        fs.writeFileSync(outPdfmetaJsonFilePath, JSON.stringify(bookmarkMetadata, null, 2));
        let withBookmarks = false;
        if (hasbin.sync("pdflatex")) {
            withBookmarks = yield addPdfBookmarks(outputFile, bookmarkMetadata);
        }
        console.log(`${withBookmarks ? "Bookmarked " : ""}PDF written on ${outputFile}`);
        console.log(`PDF bookmark metadata written on ${outPdfmetaJsonFilePath}`);
    });
}
exports.convertTask = convertTask;
function addPdfBookmarks(pdfFilePath, bookmarkMetadata) {
    // provide only name as we're going to run pdflatex in the same dir
    const pdfFileNameOnly = path.basename(pdfFilePath);
    const texSource = templates_1.default.AddPdfBookmarks.render({
        pdfFiles: [{
                filepath: pdfFileNameOnly,
                bookmarkMetadata,
            }],
    });
    const texFile = util.siblingWithExtension(pdfFilePath, "_bookmarked.tex");
    fs.writeFileSync(texFile, texSource);
    const tempOutDir = util.siblingWithExtension(texFile, "");
    if (!fs.existsSync(tempOutDir)) {
        fs.mkdirSync(tempOutDir);
    }
    return new Promise(function (resolve, reject) {
        const cmd = `pdflatex "--output-directory=${path.basename(tempOutDir)}" ${path.basename(texFile)}`;
        child_process_1.exec(cmd, {
            cwd: path.dirname(pdfFilePath),
        }, function callback(error, stdout, stderr) {
            let didIt = false;
            const texPdfFile = path.join(tempOutDir, path.basename(util.siblingWithExtension(texFile, ".pdf")));
            if (fs.existsSync(texPdfFile)) {
                fs.moveSync(texPdfFile, pdfFilePath, { overwrite: true });
                didIt = true;
            }
            fs.removeSync(tempOutDir);
            fs.unlinkSync(texFile);
            resolve(didIt);
        });
    });
}
function generatePdfBookmarkMetadata(pdfFilePath, sectionTitlesArray, taskMetadata) {
    return __awaiter(this, void 0, void 0, function* () {
        const sectionPageNumbers = {};
        const sectionTitles = new Set();
        sectionTitlesArray.forEach(c => sectionTitles.add(c));
        const doc = yield pdfjs.getDocument(pdfFilePath).promise;
        const numPages = doc.numPages;
        function loadPage(pageNum) {
            return __awaiter(this, void 0, void 0, function* () {
                const page = yield doc.getPage(pageNum);
                const content = yield page.getTextContent();
                content.items.forEach(function (item) {
                    if (sectionTitles.has(item.str)) {
                        sectionPageNumbers[item.str] = pageNum;
                    }
                });
            });
        }
        ;
        for (let i = 1; i <= numPages; i++) {
            yield loadPage(i);
        }
        const titleBookmark = {
            level: 0, page: 1,
            caption: `${taskMetadata.id} ${taskMetadata.title}`,
        };
        const sectionBookmarks = Object.entries(sectionPageNumbers).map(([caption, page]) => ({
            level: 1, page, caption,
        }));
        const bookmarks = [titleBookmark, ...sectionBookmarks];
        return { numPages, bookmarks };
    });
}
function renderPdf(mdFilePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const textMd = util_1.readFileSyncStrippingBom(mdFilePath);
        const [textHtml, metadata] = md2html.renderMarkdown(textMd, true);
        const browser = yield puppeteer.launch({ headless: true });
        const page = yield browser.newPage();
        const fileUrl = util_1.toFileUrl(mdFilePath);
        yield page.goto(fileUrl, { waitUntil: 'domcontentloaded' });
        yield page.setContent(textHtml, { waitUntil: 'networkidle2' });
        const sectionTitles = yield page.evaluate(_ => {
            const h2s = document.getElementsByTagName("H2");
            const sectionTitles = [];
            for (let i = 0; i < h2s.length; i++) {
                const section = h2s.item(i);
                if (section) {
                    sectionTitles.push(section.innerHTML);
                }
            }
            return sectionTitles;
        });
        const licence = patterns.genLicense(metadata);
        // TODO load that from CSS file?
        const baseHeaderFooterStyleParts = [
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
        const baseHeaderFooterStyle = baseHeaderFooterStyleParts.map(([name, value]) => `${name}: ${value} `).join(";");
        const footerTemplate = '' +
            `< div style = "${baseHeaderFooterStyle}" class="pdffooter" >
        <span style="flex:1 0 0; text-align: left" > ${licence.shortCopyright()} </span>
            < span style = "flex:1 0 0; text-align: center; font-style:italic" > ${metadata.id} ${metadata.title} </span>
                < span style = "flex:1 0 0; text-align: right" > Page < span class="pageNumber" > </span>/ < span class="totalPages" > </span>
                    < /div>`;
        const pdfData = yield page.pdf({
            format: 'A4',
            displayHeaderFooter: true,
            printBackground: true,
            headerTemplate: '<div/>',
            footerTemplate,
        });
        yield browser.close();
        const doc = yield pdf_lib_1.PDFDocument.load(pdfData, {
            updateMetadata: false,
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
        const pdfBytes = yield doc.save();
        return [pdfBytes, metadata, sectionTitles];
    });
}
;
//# sourceMappingURL=convert_pdf.js.map