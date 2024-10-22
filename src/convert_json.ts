import { buildASTOf } from './ast'
import { PluginOptions } from './convert_html'
import { writeData } from './fsutil'


export async function convertTask_json(taskFile: string, output: string | true, options: Partial<PluginOptions> = {}): Promise<string | true> {
  const ast = await buildASTOf(taskFile, options)
  const text = JSON.stringify(ast, undefined, 2)
  return writeData(text, output, "JSON")
}
