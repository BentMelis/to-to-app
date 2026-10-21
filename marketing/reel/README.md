# TwigList promo reel (Instagram Reels / TikTok)

`reel.html` is the whole video: a 1080×1920 scripted animation (26 s, 30 fps). Open it in a browser to preview it on a loop.

Render to mp4 (needs Node, `npm i -D playwright` and ffmpeg):

```
node marketing/reel/render.mjs            # writes marketing/reel/out/twiglist-reel.mp4
node marketing/reel/render.mjs out --frames 0,300,700   # just a few stills
```

Set `CHROMIUM=/path/to/chromium` to use a specific browser. The video is silent on purpose: pick a trending sound in the Instagram/TikTok editor.

Scenes: endless list (0–3.4 s) → it grows like a tree (–6.6) → done items sink and stack (–10.6) → deadlines turn red (–14.6) → standup flags and copy list (–18.6) → hide sensitive items when presenting (–22.4) → end card "Coming soon · Follow for the launch" (–26).
