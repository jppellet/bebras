import { convertTask_html_impl, PluginOptions } from './convert_html'

export async function convertTask_cuttle(taskFile: string, output: string | true, options: Partial<PluginOptions> = {}): Promise<string | true> {
   return convertTask_html_impl(taskFile, output, false, options)
}

