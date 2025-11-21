import imageSize from 'image-size'

type ImageSize = { width: number, height: number }
const cache = new Map<string, ImageSize>()

export function getImageSize(path: string): ImageSize {
    let size = cache.get(path)
    if (size) {
        return size
    }
    size = { width: FallbackDefaultImageSize, height: FallbackDefaultImageSize }
    try {
        const result = imageSize(path)
        if (result.width === undefined || result.height === undefined) {
            throw new Error('undefined image size')
        }
        size = { width: result.width, height: result.height }
        cache.set(path, size)
    } catch (err) {
        console.log(`Couldn't find size of image '${path}': ` + (err as any).message ?? String(err) + ", using fallback size " + FallbackDefaultImageSize)
    }
    return size
}

export function getImageWidth(path: string): number {
    return getImageSize(path).width
}

export const FallbackDefaultImageSize = 30