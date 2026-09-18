# freedium ⚡

Read Medium articles without the paywall — right in your terminal.

`freedium` is the CLI counterpart to [Freedium](https://freedium.cfd): hand it a
Medium URL and it fetches the full article through a freedium mirror, converts
the page to Markdown, and renders it in the terminal with the freedium teal
branding. No account, no bullshit, no paywall.

> For hackers the terminal is the default UI, and Medium is the default Google
> News. This combines the two.

![freedium]

## Install

```sh
npm install -g freediumcli
```

Requires Node.js **18+**. Ships with **zero dependencies** — no bundler, no
`node_modules` bloat, no supply-chain surprises. Just your terminal and the
network.

## Usage

```
freedium [options] <url>
freedium top [category] [n]
```

Read a Medium article:

```sh
freedium https://medium.com/@elmo-anderson/the-great-manure-mystery-1b184e2a44c8
```

Browse the front page in an interactive menu — move with `↑`/`↓` and press
`Enter` to open the highlighted article:

```sh
freedium top
```

```
Top articles on freedium-mirror.cfd · latest      ↑/↓ move · enter open · q quit
>  1. The Great Manure Mystery  ·  Elmo Anderson  ·  5 min
   2. Why Does Telegram Care So Much About Privacy?  ·  David Baek  ·  34 min
   3. ...
```

### Categories

`freedium top <category>` filters the list:

| category   | what it shows                                    |
| ---------- | ------------------------------------------------ |
| `latest`   | newest first (default)                           |
| `trending` | the mirror's curated front-page order            |
| `week`     | published in the last 7 days                     |
| `long`     | long reads (7+ min), longest first               |
| `all`      | the whole front page, unfiltered                 |

Any other word is treated as a keyword filter over title, excerpt, author and
publication — e.g. `freedium top ai`, `freedium top security utm`:

```sh
freedium top long        # interactive long-reads menu
freedium top security    # interactive menu of security posts
freedium top long 3      # open the 3rd long read directly
```

When output is piped, `top` prints the list instead of prompting, so it stays
scriptable.

Real output looks roughly like:

```
A Totally Normal Medium Article
───────────────────────────────
Author   ·  5 min read  ·  Jan 1, 2026

Every paywalled Medium article you've ever wanted to read,
now in your terminal. Headings, code blocks, tables, quotes
and lists all survive the trip.
```

### Options

| flag                     | description                                       |
| ------------------------ | ------------------------------------------------- |
| `-h, --help`             | show help                                         |
| `-v, --version`          | show version                                      |
| `-m, --markdown`         | output raw Markdown instead of colored text       |
| `-o, --output <path>`    | save Markdown (with frontmatter) to a file/dir    |
| `--no-color`             | disable ANSI colors                               |
| `--no-pager`             | print straight through instead of paging          |
| `--no-images`            | show images as text placeholders                  |
| `--image-width <n>`      | image width in terminal columns (default: full width) |
| `--image <value>`        | images are **off by default**; enable with `true`, `auto`, `ansi`, `sixel`, or `kitty` |
| `--host <host>`          | use a different freedium mirror                   |
| `FREEDIUM_HOST` env var  | same, via the environment                         |
| `FREEDIUM_PAGER` env var | pager command (default: `$PAGER`, else `less`)    |

Long articles open in a pager so you always start reading at the top. Disable it
with `--no-pager`, or set `FREEDIUM_PAGER` (e.g. `FREEDIUM_PAGER=cat`).

## Images

Images are **opt-in** — by default they show as a `[ image ]` placeholder. Pass
`--image true` to render them, tuned for **Linux terminals**:

```sh
freedium --image true <url>      # enable images (ANSI half-blocks by default)
freedium --image ansi <url>      # force ANSI half-blocks
freedium --image sixel <url>     # force sixel (GNOME Terminal, foot, mlterm…)
freedium --image kitty <url>     # force kitty graphics (kitty, WezTerm)
```

| mode    | where it works                                | notes                                  |
| ------- | --------------------------------------------- | -------------------------------------- |
| `kitty` | kitty, WezTerm (auto-detected)                | native protocol, full resolution      |
| `ansi`  | default when images are enabled               | half-block `▀`/`▄` with 24-bit color  |
| `sixel` | GNOME Terminal / Console 47+, Konsole, foot, mlterm | near-native resolution, real pixels |
| `text`  | images disabled                               | `[ image ]` placeholder                |

`sixel` mode is rendered by the bundled pure-JS encoder (median-cut palette, up
to 256 colors) — it decodes the image with ImageMagick and emits the sixel
protocol itself, so no special sixel tooling is needed. For `ansi` mode the
image is decoded by a system tool — the first of `magick`/`convert`, `chafa`,
`viu`, `img2txt`, `jp2a` that's installed. Without one of those, images degrade
to the text placeholder (a one-line warning is printed). Install ImageMagick
for full support:

```sh
# on Fedora
sudo dnf install ImageMagick
# on Debian/Ubuntu
sudo apt install imagemagick
# on Arch
sudo pacman -S imagemagick
```

Images require a TTY and auto-disable when stdout is piped. Tune with
`--image-width <columns>` or the `FREEDIUM_IMAGE_WIDTH` / `FREEDIUM_IMAGE_MODE`
env vars; `--no-images`, `--image false`, or `FREEDIUM_NO_IMAGES=1` turns them
off entirely.

Colors auto-disable when stdout isn't a TTY, so piping just works:

```sh
freedium -m <url> | pandoc -o article.html
freedium -o ./docs <url>
```

## How it works

1. Fetches `https://<freedium-mirror>/<medium-url>` (freedium renders the
   paywalled article server-side).
2. Extracts the article from the `.prose` container and the header metadata
   (title, author, date, reading time).
3. Converts the HTML to Markdown with a small recursive-descent tokenizer
   written for the task — no external parser libraries.
4. Renders Markdown to the terminal: teal headings, dim code framing, box-drawn
   tables, and proper word wrapping at your terminal width.

The default mirror is `freedium-mirror.cfd`, matching the freedium project's own
default. Freedium mirrors rotate; if one is unreachable, point `--host` (or
`FREEDIUM_HOST`) at another.

## Examples

```sh
# read an article
freedium https://medium.com/@user/your-article-hash

# get clean markdown for saving / piping
freedium -m <url>

# batch save several articles
freedium -o ~/articles <url-a>
freedium -o ~/articles <url-b>

# use an alternate mirror
freedium --host freedium2.example.cfd <url>
```

## License

MIT

![freedium]: https://avatars.githubusercontent.com/u/142643505?s=100&v=4