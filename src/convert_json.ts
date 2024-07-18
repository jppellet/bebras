import { buildASTOf } from './ast'
import { writeData } from './util'


export async function convertTask_json(taskFile: string, output: string | true): Promise<string | true> {
  const ast = await buildASTOf(taskFile)
  const text = JSON.stringify(ast, undefined, 2)
  return writeData(text, output, "JSON")
}
