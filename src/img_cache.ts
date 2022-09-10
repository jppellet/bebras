import imageSize from 'image-size'

const cache = new Map<string, number>()

export function getImageSize(path: string) {
    let width = cache.get(path)
    if (width) {
        return width
    }
    width = 0
    try {
        width = imageSize(path).width ?? 0
        cache.set(path, width)
    } catch (err) {
        console.log(`Couldn't find size of image '${path}': ` + (err as any).message ?? String(err))
    }
    return width
}
