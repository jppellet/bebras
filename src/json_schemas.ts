export interface PdfBookmark {
    level: number,
    caption: string,
    page: number,
}

export interface PdfBookmarkMetadata {
    numPages: number,
    bookmarks: PdfBookmark[];
}
