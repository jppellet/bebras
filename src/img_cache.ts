import imageSize from 'image-size'

const cache = new Map<string, number>()

export function getImageSize(path: string) {
    let width = cache.get(path)
    if (width) {
        return width
    }
    width = imageSize(path).width ?? 0
    cache.set(path, width)
    return width
}
