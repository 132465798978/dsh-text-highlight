# dsh-text-highlight

English | [中文](#中文说明)

Highlight keywords and key sentences in DeepSeek Harness messages, and change the font of the UI and the message body.

A small `Aa` button sits at the bottom-left of the Web GUI. Click it to open the settings panel.

## Install

```sh
dsh plugin --profile web add "https://github.com/132465798978/dsh-text-highlight/releases/download/v0.1.0/dsh-text-highlight-0.1.0.tgz"
```

From a local checkout:

```sh
dsh plugin --profile web add "D:/path/to/dsh-text-highlight/dsh-text-highlight-0.1.0.tgz"
```

Reload the page. The `Aa` button appears at the bottom-left.

## What it does

- **Keyword highlighting.** Ships with eight words (`重要` / `注意` / `结论` / `关键` / `风险` / `警告` / `建议` / `推荐`). Each word has its own colour and style (text colour, background, underline). Add, remove or recolour them in the panel.
- **Whole-sentence highlighting.** Fill in a few trigger words and every sentence containing one of them gets a translucent background.
- **Font switching.** Ten Chinese font presets (YaHei, Noto Sans SC, DengXian, SimHei, STXihei, SimSun, Noto Serif SC, KaiTi, FangSong) or any `font-family` you paste in. Scope it to the whole UI or to message bodies only.
- **Code font** is handled separately, so code blocks and KaTeX formulas are left alone.

Settings live in `localStorage` under `dsh-text-highlight/config.v2`.

## How it works

Colouring uses the **CSS Custom Highlight API**:

```js
var hl = new Highlight();
hl.add(range);                 // one Range per match
CSS.highlights.set("dsh-th-kw-0", hl);
```

```css
::highlight(dsh-th-kw-0) { color: #f5a524; }
```

It never wraps text in `<span>`. DSH renders messages with React while the answer streams in; rewriting text nodes would fight its virtual DOM and get wiped on the next paint. Highlight paints an existing range and leaves the DOM untouched.

Scanning covers `div[class*='markdown']` and skips `pre` / `code` / `kbd` / `samp` / `.katex`, inputs and the panel itself. A `MutationObserver` watches the body, debounces at 90 ms and rescans only the containers that changed.

Fonts are set two ways: the official CSS variables (`--dsw-font-family`, `--dsw-font-markdown-*`, `--ds-font-family-code`) plus an `!important` rule as a backstop. Theme plugins often set `body[data-…] *` with `!important`, so the selector carries `:not(#dsh-text-highlight-never)` — a deliberately impossible id — to raise specificity above them. Code blocks and KaTeX are excluded.

## Files

```
lib/index.js     server side: GET /dsh-text-highlight/config returns the default config
lib/client.js    client side: injects CSS, scans text, paints highlights, floating panel
cordis.patch.yml inserts the plugin into the bundle
build-demo.mjs   builds demo.html for testing the styles outside DSH
```

## Known limits

- `::highlight()` only accepts colour-ish properties (colour, background-color, text-decoration). Font size and weight cannot be changed through highlighting.
- Matching is plain text, no word boundaries: `注意` also matches `注意力`.
- Font switching changes `font-family` only, not size or line height.
- The panel is a plain DOM overlay; it follows the theme's colour variables but is not a native settings page.

## License

MIT. Use it, fork it, change it, ship it.

---

## 中文说明

给 DeepSeek Harness 的聊天文字加两件事：**关键词 / 关键句上色**，以及**换字体**。

界面左下角有个 `Aa` 小圆钮，点开就是设置面板。

### 装

```sh
dsh plugin --profile web add "https://github.com/132465798978/dsh-text-highlight/releases/download/v0.1.0/dsh-text-highlight-0.1.0.tgz"
```

装完刷新页面，左下角就出现 `Aa`。

### 能干什么

- **关键词上色**：默认 8 个词（重要 / 注意 / 结论 / 关键 / 风险 / 警告 / 建议 / 推荐），每个词能单独配颜色和样式（变色 / 底色 / 下划线），也能自己加词删词。
- **整句高亮**：填几个触发词，含这些词的整句加半透明底色，像荧光笔划过去。
- **换字体**：十个中文字体预设，或者粘任意 `font-family`。作用范围可以选「整个界面 + 正文」，也可以只换消息正文。
- **代码字体**单独管，代码块和公式不会被误伤。

配置存在 localStorage 的 `dsh-text-highlight/config.v2`。

### 原理

上色走 CSS Custom Highlight API，不往消息里插 `<span>`。DSH 的消息是 React 流式渲染的，手动改文本节点会和它的虚拟 DOM 打架，下次重绘就没了。Highlight 只是给已有文字套一层渲染层，DOM 一根手指没碰。

字体是两条腿：改官方 CSS 变量，再加 `!important` 规则兜底。皮肤插件常用 `body[data-…] *` 配 `!important` 统一设字体，所以选择器上挂了个 `:not(#dsh-text-highlight-never)`（一个永远不会出现的 id）把权重抬到 id 级。代码块和 KaTeX 单独放行。

### 已知限制

- `::highlight()` 只吃颜色类字性，改不了字号字重。
- 纯文本匹配，没有词边界，`注意` 也会命中 `注意力`。
- 字体只换 `font-family`，不改字号行高。

### 协议

MIT，随便用、随便改、随便发。
