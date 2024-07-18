import { convertTask_html_impl } from './convert_html'

export async function convertTask_cuttle(taskFile: string, output: string | true): Promise<string | true> {
   return convertTask_html_impl(taskFile, output, false)
}

