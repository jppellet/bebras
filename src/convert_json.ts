import * as fs from 'fs'
import { buildASTOf } from './ast'


export async function convertTask_json(taskFile: string, outputFile: string): Promise<string> {
  const ast = await buildASTOf(taskFile)
  await fs.promises.writeFile(outputFile, JSON.stringify(ast, undefined, 2))
  console.log(`Output written on ${outputFile}`)
  return outputFile
}
