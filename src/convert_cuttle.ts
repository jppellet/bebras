import { convertTask_html_impl, PluginOptions } from './convert_html'
import { WriteResultSingle } from './fsutil'

export async function convertTask_cuttle(taskFile: string, output: string | true, options: Partial<PluginOptions> = {}): Promise<WriteResultSingle> {
   return convertTask_html_impl(taskFile, output, false, options)
}

