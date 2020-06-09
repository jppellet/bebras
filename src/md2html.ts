import MarkdownIt = require('markdown-it');
import fs = require('fs');
import { defaultTaskMetadata, TaskMetadata } from './util';
import Token = require('markdown-it/lib/token');

export function runTerminal(fileIn: string, fileOut: string) {
  const mdText = fs.readFileSync(fileIn, 'utf8');
  const [htmlText, metadata] = renderMarkdown(mdText, true);
  fs.writeFileSync(fileOut, htmlText);
  console.log(`Wrote ${fileOut}`);
}

export function renderMarkdown(text: string, fullHtml: boolean): [string, TaskMetadata] {
  const md = MarkdownIt().use(require("./markdown-it-bebras"));

  const env: any = {};
  const result = md.render(text, env);
  const metadata: TaskMetadata = env.taskMetadata ?? defaultTaskMetadata();

  const htmlStart = '' +
    `<!DOCTYPE html>
     <html lang="en">
       <head>
         <meta charset="utf-8">
         <title>${metadata.id} ${metadata.title}</title>
        <link href="../bebrasmdstyle.css" rel="stylesheet" />
       </head>
       <body>`;

  const htmlEnd = '' +
    `  </body>
     </html>`;

  const htmlText = !fullHtml ? result : htmlStart + result + htmlEnd;

  return [htmlText, metadata];
}

export function parseMarkdown(text: string): [Token[], TaskMetadata] {
  const md = MarkdownIt().use(require("./markdown-it-bebras"));
  const env: any = {};
  const tokens = md.parse(text, env);
  const metadata: TaskMetadata = env.taskMetadata ?? defaultTaskMetadata();
  return [tokens, metadata];
}
