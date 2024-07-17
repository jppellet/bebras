import { convertTask_html_impl } from './convert_html'

export async function convertTask_cuttle(taskFile: string, outputFile: string): Promise<string> {
   return convertTask_html_impl(taskFile, outputFile, false)
}

