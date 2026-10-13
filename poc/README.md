# Todo tree

A todo list shaped like a tree. Projects branch into sub-projects, todos and notes.
It is a Progressive Web App: it installs on phones and computers and works offline.

## Put it online

Upload this whole folder (index.html, manifest.webmanifest, sw.js and the icons folder)
to any static web host that serves over HTTPS. Easy options:

- Netlify Drop: drag the folder onto https://app.netlify.com/drop
- GitHub Pages: push the folder to a repo and turn on Pages in the repo settings
- Cloudflare Pages, Vercel, or your own web server

To try it on your own computer first, run `python3 -m http.server` in this folder
and open http://localhost:8000. (Opening index.html directly works too, but
installing and offline mode need it to be served.)

## Install it

- Chrome or Edge on a computer: click "Install app" in the toolbar, or the install icon in the address bar.
- Android (Chrome): "Install app" in the toolbar, or menu → Install app.
- iPhone or iPad (Safari): Share → Add to Home Screen.

## Your data

Everything is stored in the browser on each device. Nothing is sent to a server.
Use the download button in the toolbar to save a backup (.json) and the upload
button to restore it or move your tree to another device.

## Updating

After changing index.html, bump CACHE in sw.js (for example todo-tree-v2) so
installed copies pick up the new version.
