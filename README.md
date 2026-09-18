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

Browse what's new on **medium.com** in an interactive menu — move with `↑`/`↓`
and press `Enter` to open the highlighted article:

```sh
freedium top
```

```
Top articles on medium.com · latest        ↑/↓ move · enter open · q quit
>  1. The Empathy Gap: Why AI Can Simulate Understanding…  ·  Pascal Gemperli  ·  4 min
   2. Machine Learning: A Recommended Reading List  ·  Shreyas Naphad  ·  6 min
   3. ...
```

### Categories

`freedium top <category>` chooses which Medium feed to pull:

| category   | what it shows                                          |
| ---------- | ------------------------------------------------------ |
| `latest`   | newest articles across the default topics (default)    |
| `trending` | this week's most-clapped stories                        |
| `week`     | published in the last 7 days, by claps                  |
| `long`     | 7+ minute reads, longest first                          |
| `all`      | all-time most-clapped stories                           |

Any other word is treated as a **Medium topic** — `freedium top ai`,
`freedium top security`, `freedium top machine learning` — and pulls that tag's
feed. Multi-word topics are turned into tag slugs (`machine learning` →
`machine-learning`):

```sh
freedium top long                  # interactive long-reads menu
freedium top security              # interactive menu of the security topic
freedium top machine learning 3    # open the 3rd "machine-learning" article
```

Bare `freedium top` merges several popular topics (technology, programming,
AI, data science, software development, startup) and de-duplicates them, so you
get a broad list rather than one narrow feed.

Data comes from Medium's own topic feed (the same one its topic pages use),
with the per-tag RSS feed as a fallback. When output is piped, `top` prints the
list instead of prompting, so it stays scriptable.

### Search

Search Medium's public index and browse matching articles interactively:

```sh
freedium search rust                # search articles about "rust"
freedium search "machine learning"  # multi-word queries
freedium search rust 3              # open the 3rd result directly
freedium search rust --limit 10     # cap at 10 results (default 25)
```

Each result shows the title, author, reading time, date and clap count. When you
pipe the output, the list prints one per line instead of prompting — handy for
scripts. A trailing number opens that result immediately (1-based):

```sh
freedium search kubernetes 7 | head
freedium -m "search quantum computing 1" > article.md
```

Results come from Medium's own search GraphQL endpoint, so they stay current.

### Configuration

Settings are persisted at `~/.freedium/config.json` and picked up on every run.
Preferences follow a **low→high** precedence: config file values are the default,
**environment variables** override those, and **CLI flags** override everything:

| setting         | config key      | env var              | flag               |
| --------------- | --------------- | -------------------- | ------------------ |
| OS              | `os`            | `FREEDIUM_OS`        | _auto-detected_    |
| Image mode      | `image`         | `FREEDIUM_IMAGE_MODE`| `--image`          |
| Image width     | `imageWidth`    | `FREEDIUM_IMAGE_WIDTH`| `--image-width`   |
| Mirror host     | `host`          | `FREEDIUM_HOST`      | `--host`           |
| Extra mirrors   | _array_         | `FREEDIUM_HOSTS`     | _—_                |
| Search limit    | `limit`         | `FREEDIUM_LIMIT`     | `--limit`          |
| Pager           | _—_             | `FREEDIUM_PAGER`     | `--no-pager`       |
| Disable images  | _—_             | `FREEDIUM_NO_IMAGES` | `--no-images`      |

`FREEDIUM_OS` accepts `linux`, `macos`, `windows`, or `freebsd` and overrides
autodetection — useful to force `iterm2` mode for iTerm2 when running under
`tmux`/`screen`, or to point a non-standard terminal at the right renderer.

```sh
# set once via the CLI (written to config)
freedium --image kitty --image-width 80
# or manually edit ~/.freedium/config.json
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
| `--image <value>`        | images are **off by default**; enable with `true`, `auto`, `ansi`, `sixel`, `kitty`, `iterm2`, or `windows` |
| `--image-width <n>`      | image width in terminal columns (default: full width) |
| `--limit <n>`            | max search results (default: 25)                |
| `--host <host>`          | use a different freedium mirror                   |
| `FREEDIUM_HOST` env var  | same, via the environment                         |
| `FREEDIUM_HOSTS` env var | comma-separated extra mirrors to fail over to     |
| `FREEDIUM_PAGER` env var | pager command (default: `$PAGER`, else `less`)    |

Long articles open in a pager so you always start reading at the top. Disable it
with `--no-pager`, or set `FREEDIUM_PAGER` (e.g. `FREEDIUM_PAGER=cat`).

### When the mirror is down

The community mirror `freedium-mirror.cfd` goes up and down periodically. The
CLI retries transient `5xx`/network failures and can hop to other mirrors:

```sh
FREEDIUM_HOSTS="freedium.cfd,my-mirror.example" freedium <url>
```

`freedium top` listings come straight from medium.com, so they keep working even
when the mirror is down — only opening an article needs the mirror.

## Images

Images are **opt-in** — by default they show as a `[ image ]` placeholder. The
correct backend is chosen automatically from your OS and terminal, then you can
force a specific one with `--image`:

```sh
freedium --image true <url>      # auto: best mode for your OS (macOS -> iterm2, Linux -> kitty/sixel/ansi)
freedium --image ansi <url>      # force ANSI half-blocks
freedium --image sixel <url>     # force sixel (GNOME Terminal, foot, mlterm…)
freedium --image kitty <url>     # force kitty graphics (kitty, WezTen)
freedium --image iterm2 <url>   # force iTerm2 OSC 1337 (macOS)
freedium --image windows <url>  # force Windows terminal decoder rendering
```

| mode      | where it works                                  | notes                                    |
| --------- | ----------------------------------------------- | ---------------------------------------- |
| `iterm2`  | iTerm2 on macOS (OSC 1337)                       | no system decoder needed, base64 in-band |
| `kitty`   | kitty, WezTen (auto-detected on Linux/macOS)     | native protocol, full resolution        |
| `ansi`    | anywhere with a decoder (Linux default)         | half-block with 24-bit color            |
| `sixel`   | GNOME Terminal / Console 47+, Konsole, foot, mlterm | near-native resolution, real pixels      |
| `windows` | Windows Terminal (requires ImageMagick)          | uses system decoder, then half-blocks    |
| `text`    | images disabled                                 | `[ image ]` placeholder                  |

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