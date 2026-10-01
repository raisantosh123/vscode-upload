# Interactive PDF Reader

A local-first PDF reader built with plain HTML, CSS, and JavaScript, using PDF.js for rendering.

## Run in VS Code

1. Open the `interactive-pdf-reader` folder in VS Code.
2. Install the **Live Server** extension.
3. Right-click `index.html` and choose **Open with Live Server**.

No Live Server? In the VS Code terminal run `python -m http.server 5500`, then open http://localhost:5500.

Open it through a local server rather than by double-clicking the file, because PDF.js loads a web worker.

## Features

- Open a PDF (button or drag and drop); it is kept in the library for next time
- Play local video and audio files with native browser controls; media stays in memory and is not uploaded or saved to the library
- Open a web page in a new tab or load a direct online PDF link in the reader
- Highlight selected text in four colours, and attach notes to each highlight
- Bookmark pages
- Resume at the last page you read, with a progress bar
- Search text across the whole document
- Back up and restore notes, highlights, bookmarks, and progress as a JSON file
- Works offline after the first load once PDF.js is downloaded (see below)

PDF links load in the reader when the host permits cross-origin requests (CORS). Use the “Open as” selector if a PDF link does not end in `.pdf`; web pages open in a separate browser tab.

Video and audio format support depends on the browser and the codecs available on the device. Open media files from your device; this reader does not download or persist media files.

## Fully offline

The PDF.js files load from a CDN. To remove that dependency, download `pdf.min.js` and `pdf.worker.min.js` (version 3.11.174) into a `lib/` folder and change the script tag in `index.html` and the `workerSrc` line at the top of `app.js` to point to them.

## Files

- `index.html` page structure
- `style.css` layout and theme (light and dark)
- `app.js` reading, highlights, notes, bookmarks, search, storage, backup
