# Canvas integration

This directory contains the independently built MIT-licensed SuperSplat 3.7.0 source. Install its dependencies with `npm ci --prefix vendor/supersplat`, then run `npm run supersplat:build` from the canvas root. The generated public/supersplat directory is not checked in and must be produced before packaging the desktop application.

The canvas node stores local assets and editable documents in IndexedDB, and can save camera views and capture an image node. Project bundle portability for these assets is not implemented yet; keep original files and export a SuperSplat document separately before moving projects to another device.

The desktop node now opens Google Chrome through a loopback-only temporary server. Each editor session has a random URL token and a four-hour server lifetime. The page and editor resources are bundled with the application. Save, capture and view actions return to the originating node while the app remains open. Chrome must be installed. The model currently crosses the native command boundary as base64, so very large assets require extra memory.
