/* dsh-text-highlight · client
 *
 * 两件事：
 *   1. 把正文里的关键词 / 关键句上色，用 CSS Custom Highlight API，
 *      不往 React 的 DOM 里塞 span（流式输出时塞了会被下一次 reconcile 干掉）。
 *   2. 换字体：一份 CSS 变量 + 一份 !important 兜底，代码块和 KaTeX 单独放行。
 *
 * 配置存在 localStorage('dsh-text-highlight/config')，首次没有就去
 * /dsh-text-highlight/config 拉服务端的默认值。
 */
window.__ModuleLoader__.load({
  id: "dsh-text-highlight",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var inject = ["layout"];

    /* ---------------------------------------------------------------- 常量 */

    var STYLE_ID = "dsh-text-highlight-style";
    var UI_STYLE_ID = "dsh-text-highlight-ui";
    var ROOT_ATTR = "data-dsh-th-scope";
    var LS_KEY = "dsh-text-highlight/config.v2";
    var CONFIG_ROUTE = "/dsh-text-highlight/config";
    var HL_PREFIX = "dsh-th-kw-";
    var SENTENCE_HL = "dsh-th-sentence";
    var MARKDOWN_SELECTOR = "div[class*='markdown']";
    var SKIP_ANCESTOR_SELECTOR =
      "pre, code, kbd, samp, .katex, .dsh-th-panel, .dsh-th-fab, [contenteditable='true'], textarea, input, script, style";

    var DEFAULT_CONFIG = {
      enabled: true,
      fontFamily: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
      fontScope: "all",
      codeFontFamily: '"Cascadia Mono", Consolas, "JetBrains Mono", ui-monospace, monospace',
      rules: [
        { text: "重要", color: "#f5a524", style: "text" },
        { text: "注意", color: "#f5a524", style: "text" },
        { text: "结论", color: "#35c2a8", style: "text" },
        { text: "关键", color: "#35c2a8", style: "text" },
        { text: "风险", color: "#ef4444", style: "text" },
        { text: "警告", color: "#ef4444", style: "text" },
        { text: "建议", color: "#4f8ff7", style: "text" },
        { text: "推荐", color: "#4f8ff7", style: "text" },
      ],
      sentenceTriggers: [],
      sentenceColor: "#7c9cff",
      sentenceStyle: "background",
    };

    var FONT_PRESETS = [
      [{ label: "系统默认（跟随 DSH）", value: "" }],
      [
        { label: "微软雅黑", value: '"Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif' },
        { label: "思源黑体 Noto Sans SC", value: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif' },
        { label: "等线 DengXian", value: '"DengXian", "等线", "Microsoft YaHei", sans-serif' },
        { label: "黑体 SimHei", value: '"SimHei", "Microsoft YaHei", sans-serif' },
        { label: "华文细黑 STXihei", value: '"STXihei", "Microsoft YaHei", sans-serif' },
      ],
      [
        { label: "宋体 SimSun", value: '"SimSun", "Songti SC", serif' },
        { label: "思源宋体 Noto Serif SC", value: '"Noto Serif SC", "Source Han Serif SC", "SimSun", serif' },
        { label: "楷体 KaiTi", value: '"KaiTi", "STKaiti", "楷体", serif' },
        { label: "仿宋 FangSong", value: '"FangSong", "STFangsong", serif' },
      ],
    ];

    /* -------------------------------------------------------------- 小工具 */

    function isPlainObject(value) {
      return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function clampText(value, fallback) {
      return typeof value === "string" && value.trim() ? value.trim() : fallback;
    }

    function normalizeRules(input) {
      if (!Array.isArray(input)) return DEFAULT_CONFIG.rules.map((rule) => ({ ...rule }));
      var out = [];
      for (var i = 0; i < input.length; i++) {
        var rule = input[i];
        if (!isPlainObject(rule)) continue;
        var text = clampText(rule.text, "");
        if (!text) continue;
        out.push({
          text: text,
          color: clampText(rule.color, "#f5a524"),
          style: rule.style === "background" || rule.style === "underline" ? rule.style : "text",
        });
      }
      return out;
    }

    function normalizeConfig(input) {
      var raw = isPlainObject(input) ? input : {};
      return {
        enabled: raw.enabled === undefined ? DEFAULT_CONFIG.enabled : Boolean(raw.enabled),
        fontFamily: typeof raw.fontFamily === "string" ? raw.fontFamily.trim() : DEFAULT_CONFIG.fontFamily,
        fontScope: raw.fontScope === "markdown" ? "markdown" : "all",
        codeFontFamily: clampText(raw.codeFontFamily, DEFAULT_CONFIG.codeFontFamily),
        rules: normalizeRules(raw.rules),
        sentenceTriggers: Array.isArray(raw.sentenceTriggers)
          ? raw.sentenceTriggers.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
          : [],
        sentenceColor: clampText(raw.sentenceColor, DEFAULT_CONFIG.sentenceColor),
        sentenceStyle:
          raw.sentenceStyle === "text" || raw.sentenceStyle === "underline"
            ? raw.sentenceStyle
            : DEFAULT_CONFIG.sentenceStyle,
      };
    }

    function hexToRgba(hex, alpha) {
      var match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || "").trim());
      if (!match) return "rgba(124, 156, 255, " + alpha + ")";
      var value = match[1];
      if (value.length === 3) value = value[0] + value[0] + value[1] + value[1] + value[2] + value[2];
      return (
        "rgba(" +
        parseInt(value.slice(0, 2), 16) +
        ", " +
        parseInt(value.slice(2, 4), 16) +
        ", " +
        parseInt(value.slice(4, 6), 16) +
        ", " +
        alpha +
        ")"
      );
    }

    function escapeRegExp(text) {
      return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    /* -------------------------------------------------------------- 状态 */

    var config = null;
    var scanTimer = 0;
    var pendingRoots = new Set();
    var globalRescan = false;
    var observer = null;
    var styleEl = null;
    var uiStyleEl = null;
    var panelEl = null;
    var fabEl = null;
    var registeredNames = [];
    /** @type {Map<Element, { buckets: any[][], sentences: any[] }>} */
    var containerState = new Map();

    /* ------------------------------------------------------------ 配置读写 */

    function readLocalConfig() {
      try {
        var raw = window.localStorage.getItem(LS_KEY);
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        return isPlainObject(parsed) ? normalizeConfig(parsed) : null;
      } catch (error) {
        return null;
      }
    }

    function writeLocalConfig(next) {
      try {
        window.localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch (error) {
        /* 隐私模式写不进去就算了，本次会话仍生效 */
      }
    }

    function fetchServerConfig() {
      return fetch(CONFIG_ROUTE, { headers: { accept: "application/json" } })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
    }

    /* -------------------------------------------------------------- 样式层 */

    function fontVariables() {
      var font = config.fontFamily || "inherit";
      var code = config.codeFontFamily || "inherit";
      return [
        ":root{",
        "  --dsh-th-font:" + font + ";",
        "  --dsh-th-code-font:" + code + ";",
        "  --dsw-font-family:" + font + ";",
        "  --dsw-font-markdown-base-font-family:" + font + ";",
        "  --dsw-font-markdown-h1-font-family:" + font + ";",
        "  --dsw-font-markdown-h2-font-family:" + font + ";",
        "  --dsw-font-markdown-h3-font-family:" + font + ";",
        "  --dsw-font-markdown-h4-font-family:" + font + ";",
        "  --dsw-font-markdown-table-font-family:" + font + ";",
        "  --dsw-font-markdown-table-head-font-family:" + font + ";",
        "  --ds-font-family-code:" + code + ";",
        "}",
      ].join("\n");
    }

    function fontRules() {
      var markdownOnly = config.fontScope === "markdown";
      var root = markdownOnly ? MARKDOWN_SELECTOR : "html body";
      // :not(#…-never) 是故意的：皮肤插件会用 body[data-…] * 这种更高特异性的
      // !important 规则统一设字体，只靠 html body * 压不住，加一个永远为真的 id
      // 否选器把特异性抬到 (1,0,3) 才赢。
      var boost = ":not(#dsh-text-highlight-never)";
      var out = [];
      out.push(root + " *" + boost + "{font-family:var(--dsh-th-font) !important;}");
      out.push(root + "{font-family:var(--dsh-th-font) !important;}");
      out.push(root + " :is(pre, pre *, code, kbd, samp)" + boost + "{font-family:var(--dsh-th-code-font) !important;}");
      out.push(
        root +
          " :is(.katex, .katex *)" +
          boost +
          '{font-family:KaTeX_Main, KaTeX_Math, "Times New Roman", serif !important;}',
      );
      out.push(
        root +
          " :is(.katex .mathnormal, .katex .mathit)" +
          boost +
          '{font-family:KaTeX_Math, "Times New Roman", serif !important;}',
      );
      return out.join("\n");
    }

    function highlightCssRules() {
      var out = [];
      for (var i = 0; i < config.rules.length; i++) {
        var rule = config.rules[i];
        var name = HL_PREFIX + i;
        if (rule.style === "background") {
          out.push("::highlight(" + name + "){background-color:" + hexToRgba(rule.color, 0.32) + ";}");
        } else if (rule.style === "underline") {
          out.push(
            "::highlight(" +
              name +
              "){color:" +
              rule.color +
              ";text-decoration-line:underline;text-decoration-thickness:2px;text-underline-offset:2px;}",
          );
        } else {
          out.push("::highlight(" + name + "){color:" + rule.color + ";}");
        }
      }
      if (config.sentenceStyle === "background") {
        out.push("::highlight(" + SENTENCE_HL + "){background-color:" + hexToRgba(config.sentenceColor, 0.2) + ";}");
      } else if (config.sentenceStyle === "underline") {
        out.push(
          "::highlight(" +
            SENTENCE_HL +
            "){color:" +
            config.sentenceColor +
            ";text-decoration-line:underline;text-decoration-thickness:2px;text-underline-offset:2px;}",
        );
      } else {
        out.push("::highlight(" + SENTENCE_HL + "){color:" + config.sentenceColor + ";}");
      }
      return out.join("\n");
    }

    function buildStyleText() {
      var fontCss = config.fontFamily ? fontRules() : "";
      return [fontVariables(), fontCss, highlightCssRules()].filter(Boolean).join("\n\n");
    }

    function ensureStyleElement() {
      if (!styleEl || !styleEl.isConnected) {
        styleEl = document.getElementById(STYLE_ID);
        if (!styleEl) {
          styleEl = document.createElement("style");
          styleEl.id = STYLE_ID;
          document.head.appendChild(styleEl);
        }
      }
      return styleEl;
    }

    function ensureUiStyleElement() {
      if (!uiStyleEl || !uiStyleEl.isConnected) {
        uiStyleEl = document.getElementById(UI_STYLE_ID);
        if (!uiStyleEl) {
          uiStyleEl = document.createElement("style");
          uiStyleEl.id = UI_STYLE_ID;
          document.head.appendChild(uiStyleEl);
        }
      }
      return uiStyleEl;
    }

    function paintStyle() {
      ensureStyleElement().textContent = buildStyleText();
      document.documentElement.setAttribute(ROOT_ATTR, config.fontScope);
    }

    /* ------------------------------------------------------------ 高亮扫描 */

    function clearHighlights() {
      if (!window.CSS || !window.CSS.highlights) return;
      for (var i = 0; i < registeredNames.length; i++) {
        try {
          window.CSS.highlights.delete(registeredNames[i]);
        } catch (error) {
          /* ignore */
        }
      }
      registeredNames = [];
    }

    function collectTextNodes(root) {
      var nodes = [];
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          var parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest(SKIP_ANCESTOR_SELECTOR)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      var current = walker.nextNode();
      while (current) {
        nodes.push(current);
        current = walker.nextNode();
      }
      return nodes;
    }

    function overlaps(taken, start, end) {
      for (var i = 0; i < taken.length; i++) {
        if (start < taken[i][1] && end > taken[i][0]) return true;
      }
      return false;
    }

    function scanContainer(container, matchers) {
      var buckets = new Array(config.rules.length);
      for (var i = 0; i < buckets.length; i++) buckets[i] = [];
      var sentences = [];
      var nodes = collectTextNodes(container);

      for (var n = 0; n < nodes.length; n++) {
        var node = nodes[n];
        var text = node.nodeValue;
        var taken = [];

        for (var m = 0; m < matchers.length; m++) {
          var matcher = matchers[m];
          matcher.regex.lastIndex = 0;
          var hit = matcher.regex.exec(text);
          while (hit && hit[0]) {
            var start = hit.index;
            var end = start + hit[0].length;
            if (!overlaps(taken, start, end)) {
              taken.push([start, end]);
              var range = document.createRange();
              range.setStart(node, start);
              range.setEnd(node, end);
              buckets[m].push(range);
            }
            hit = matcher.regex.exec(text);
          }
        }

        if (config.sentenceTriggers.length) {
          var sentenceRegex = /[^。！？!?\n]+[。！？!?]?/g;
          var sentence = sentenceRegex.exec(text);
          while (sentence) {
            var piece = sentence[0];
            for (var t = 0; t < config.sentenceTriggers.length; t++) {
              if (piece.indexOf(config.sentenceTriggers[t]) !== -1) {
                var sentenceRange = document.createRange();
                sentenceRange.setStart(node, sentence.index);
                sentenceRange.setEnd(node, sentence.index + piece.length);
                sentences.push(sentenceRange);
                break;
              }
            }
            sentence = sentenceRegex.exec(text);
          }
        }
      }

      return { buckets: buckets, sentences: sentences };
    }

    function refreshHighlights() {
      clearHighlights();
      if (!config.enabled) return;
      if (!window.CSS || !window.CSS.highlights || typeof window.Highlight !== "function") return;

      var buckets = [];
      for (var i = 0; i < config.rules.length; i++) buckets.push([]);
      var sentences = [];

      containerState.forEach(function (state, container) {
        if (!container.isConnected) return;
        for (var b = 0; b < state.buckets.length; b++) {
          if (state.buckets[b].length) buckets[b].push.apply(buckets[b], state.buckets[b]);
        }
        if (state.sentences.length) sentences.push.apply(sentences, state.sentences);
      });

      for (var k = 0; k < buckets.length; k++) {
        if (!buckets[k].length) continue;
        var name = HL_PREFIX + k;
        try {
          var highlight = new window.Highlight();
          for (var r = 0; r < buckets[k].length; r++) highlight.add(buckets[k][r]);
          window.CSS.highlights.set(name, highlight);
          registeredNames.push(name);
        } catch (error) {
          /* 单个规则挂了不影响其他规则 */
        }
      }

      if (sentences.length) {
        try {
          var sentenceHighlight = new window.Highlight();
          for (var s = 0; s < sentences.length; s++) sentenceHighlight.add(sentences[s]);
          window.CSS.highlights.set(SENTENCE_HL, sentenceHighlight);
          registeredNames.push(SENTENCE_HL);
        } catch (error) {
          /* ignore */
        }
      }
    }

    function buildMatchers() {
      return config.rules.map(function (rule, index) {
        return { index: index, regex: new RegExp(escapeRegExp(rule.text), "gi") };
      });
    }

    function rescan(roots, isGlobal) {
      if (!config) return;
      var matchers = buildMatchers();

      if (isGlobal) {
        var all = document.querySelectorAll(MARKDOWN_SELECTOR);
        var live = new Set();
        for (var i = 0; i < all.length; i++) {
          live.add(all[i]);
          containerState.set(all[i], scanContainer(all[i], matchers));
        }
        containerState.forEach(function (_state, element) {
          if (!live.has(element) || !element.isConnected) containerState.delete(element);
        });
      } else {
        for (var j = 0; j < roots.length; j++) {
          var container = roots[j];
          if (!container.isConnected) {
            containerState.delete(container);
            continue;
          }
          containerState.set(container, scanContainer(container, matchers));
        }
      }

      refreshHighlights();
    }

    function nearestContainers(node) {
      var element = node && node.nodeType === 1 ? node : node && node.parentElement;
      while (element && element !== document.documentElement) {
        if (element.matches && element.matches(MARKDOWN_SELECTOR)) return [element];
        element = element.parentElement;
      }
      return [];
    }

    function scheduleScan(roots, isGlobal) {
      if (roots && roots.length) {
        for (var i = 0; i < roots.length; i++) pendingRoots.add(roots[i]);
      }
      if (isGlobal) globalRescan = true;
      if (scanTimer) return;
      scanTimer = window.setTimeout(function () {
        scanTimer = 0;
        var collected = Array.from(pendingRoots);
        var global = globalRescan;
        pendingRoots.clear();
        globalRescan = false;
        try {
          rescan(collected, global);
        } catch (error) {
          console.error("[dsh-text-highlight] scan failed", error);
        }
      }, 90);
    }

    function observe() {
      if (observer) return;
      observer = new MutationObserver(function (records) {
        var roots = [];
        var global = false;
        for (var i = 0; i < records.length; i++) {
          var record = records[i];
          var found = nearestContainers(record.target);
          if (found.length) {
            roots.push.apply(roots, found);
            continue;
          }
          if (record.type === "childList") {
            for (var j = 0; j < record.addedNodes.length; j++) {
              var added = record.addedNodes[j];
              if (added.nodeType !== 1) continue;
              if (added.matches && added.matches(MARKDOWN_SELECTOR)) {
                roots.push(added);
                continue;
              }
              if (added.querySelectorAll) {
                var inner = added.querySelectorAll(MARKDOWN_SELECTOR);
                for (var k = 0; k < inner.length; k++) roots.push(inner[k]);
              }
            }
            for (var r = 0; r < record.removedNodes.length; r++) {
              var removed = record.removedNodes[r];
              if (removed.nodeType !== 1) continue;
              if (removed.matches && removed.matches(MARKDOWN_SELECTOR)) {
                containerState.delete(removed);
                global = true;
              }
            }
          } else if (record.type === "characterData") {
            global = true;
          }
        }
        if (!roots.length && !global) return;
        scheduleScan(roots, global || !roots.length);
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    /* ------------------------------------------------------------ 设置面板 */

    var PANEL_CSS = [
      ".dsh-th-fab{position:fixed;left:10px;bottom:10px;z-index:80;width:34px;height:34px;border-radius:50%;border:1px solid rgba(127,127,127,.35);background:var(--dsw-color-bg-elevated,#1b1d23);color:var(--dsw-color-text-primary,#e6e8ee);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);font-size:13px;letter-spacing:-.03em;line-height:1;transition:transform .15s ease;opacity:.7}",
      ".dsh-th-fab:hover{transform:scale(1.06);opacity:1}",
      ".dsh-th-panel{position:fixed;left:10px;bottom:52px;z-index:81;width:340px;max-height:min(72vh,640px);overflow:auto;border-radius:14px;border:1px solid rgba(127,127,127,.3);background:var(--dsw-color-bg-elevated,#1b1d23);color:var(--dsw-color-text-primary,#e6e8ee);box-shadow:0 18px 48px rgba(0,0,0,.42);padding:14px 14px 12px;font-size:12.5px;line-height:1.5}",
      ".dsh-th-panel h4{margin:0 0 10px;font-size:13px;font-weight:600;display:flex;justify-content:space-between;align-items:center;letter-spacing:.02em}",
      ".dsh-th-row{display:flex;align-items:center;gap:8px;margin:7px 0}",
      ".dsh-th-row label{flex:0 0 62px;opacity:.72}",
      ".dsh-th-panel input[type='text'],.dsh-th-panel select{flex:1 1 auto;min-width:0;padding:5px 7px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.09);color:inherit;font-size:12px;outline:none}",
      ".dsh-th-panel input[type='text']:focus,.dsh-th-panel select:focus{border-color:#4f8ff7}",
      ".dsh-th-panel input[type='color']{flex:0 0 26px;width:26px;height:24px;padding:0;border:1px solid rgba(127,127,127,.35);border-radius:6px;background:transparent;cursor:pointer}",
      ".dsh-th-rules{margin:6px 0 4px;display:flex;flex-direction:column;gap:6px}",
      ".dsh-th-rule{display:flex;align-items:center;gap:6px}",
      ".dsh-th-rule input[type='text']{flex:1 1 auto}",
      ".dsh-th-rule select{flex:0 0 68px}",
      ".dsh-th-mini{border:none;background:transparent;color:inherit;opacity:.55;cursor:pointer;font-size:12px;padding:2px 5px;border-radius:5px}",
      ".dsh-th-mini:hover{opacity:1;background:rgba(127,127,127,.16)}",
      ".dsh-th-actions{display:flex;gap:8px;margin-top:12px;position:sticky;bottom:-12px;padding:10px 0 2px;background:var(--dsw-color-bg-elevated,#1b1d23);border-top:1px solid rgba(127,127,127,.16)}",
      ".dsh-th-actions button{flex:1;padding:6px 8px;border-radius:8px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.12);color:inherit;cursor:pointer;font-size:12px}",
      ".dsh-th-actions button:hover{background:rgba(127,127,127,.22)}",
      ".dsh-th-actions button.dsh-th-primary{background:#4f8ff7;border-color:#4f8ff7;color:#fff}",
      ".dsh-th-actions button.dsh-th-primary:hover{background:#3f7fe7}",
      ".dsh-th-hint{opacity:.5;font-size:11px;margin:8px 0 0}",
      ".dsh-th-sep{height:1px;background:rgba(127,127,127,.18);margin:12px 0 8px}",
    ].join("\n");

    function el(tag, className, text) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function buildPanel() {
      var panel = el("div", "dsh-th-panel");
      panel.setAttribute("data-dsh-th-ui", "1");

      var head = el("h4", null, "正文高亮 / 字体");
      var close = el("button", "dsh-th-mini", "✕");
      close.title = "关闭";
      close.addEventListener("click", function () {
        togglePanel(false);
      });
      head.appendChild(close);
      panel.appendChild(head);

      var enabledRow = el("div", "dsh-th-row");
      enabledRow.appendChild(el("label", null, "关键词"));
      var enabledBox = document.createElement("input");
      enabledBox.type = "checkbox";
      enabledBox.checked = config.enabled;
      enabledBox.addEventListener("change", function () {
        config.enabled = enabledBox.checked;
        commit();
      });
      enabledRow.appendChild(enabledBox);
      panel.appendChild(enabledRow);

      var fontRow = el("div", "dsh-th-row");
      fontRow.appendChild(el("label", null, "正文字体"));
      var fontSelect = document.createElement("select");
      var presetValues = new Set();
      for (var g = 0; g < FONT_PRESETS.length; g++) {
        var group = document.createElement("optgroup");
        group.label = g === 0 ? "预设" : g === 1 ? "无衬线" : "衬线";
        var presets = FONT_PRESETS[g];
        for (var pi = 0; pi < presets.length; pi++) {
          var option = document.createElement("option");
          option.value = presets[pi].value;
          option.textContent = presets[pi].label;
          presetValues.add(presets[pi].value);
          group.appendChild(option);
        }
        fontSelect.appendChild(group);
      }
      if (!presetValues.has(config.fontFamily)) {
        var customOption = document.createElement("option");
        customOption.value = config.fontFamily;
        customOption.textContent = "自定义";
        fontSelect.appendChild(customOption);
      }
      fontSelect.value = config.fontFamily;
      fontSelect.addEventListener("change", function () {
        config.fontFamily = fontSelect.value;
        commit();
        rebuildPanel();
      });
      fontRow.appendChild(fontSelect);
      panel.appendChild(fontRow);

      var customRow = el("div", "dsh-th-row");
      customRow.appendChild(el("label", null, "自定义"));
      var customInput = document.createElement("input");
      customInput.type = "text";
      customInput.placeholder = 'font-family 栈，留空=不换';
      customInput.value = config.fontFamily;
      customInput.addEventListener("change", function () {
        config.fontFamily = customInput.value.trim();
        commit();
        rebuildPanel();
      });
      customRow.appendChild(customInput);
      panel.appendChild(customRow);

      var scopeRow = el("div", "dsh-th-row");
      scopeRow.appendChild(el("label", null, "作用范围"));
      var scopeSelect = document.createElement("select");
      [
        ["all", "整个界面 + 正文"],
        ["markdown", "只换正文"],
      ].forEach(function (pair) {
        var option = document.createElement("option");
        option.value = pair[0];
        option.textContent = pair[1];
        scopeSelect.appendChild(option);
      });
      scopeSelect.value = config.fontScope;
      scopeSelect.addEventListener("change", function () {
        config.fontScope = scopeSelect.value;
        commit();
      });
      scopeRow.appendChild(scopeSelect);
      panel.appendChild(scopeRow);

      var codeRow = el("div", "dsh-th-row");
      codeRow.appendChild(el("label", null, "代码字体"));
      var codeInput = document.createElement("input");
      codeInput.type = "text";
      codeInput.value = config.codeFontFamily;
      codeInput.addEventListener("change", function () {
        config.codeFontFamily = codeInput.value.trim() || DEFAULT_CONFIG.codeFontFamily;
        commit();
      });
      codeRow.appendChild(codeInput);
      panel.appendChild(codeRow);

      panel.appendChild(el("div", "dsh-th-sep"));

      var rulesTitle = el("div", "dsh-th-row");
      rulesTitle.appendChild(el("label", null, "关键词"));
      var addRule = el("button", "dsh-th-mini", "＋ 添加");
      addRule.addEventListener("click", function () {
        config.rules.push({ text: "新词", color: "#f5a524", style: "text" });
        commit();
        rebuildPanel();
        window.requestAnimationFrame(function () {
          if (!panelEl) return;
          panelEl.scrollTop = panelEl.scrollHeight;
          var inputs = panelEl.querySelectorAll(".dsh-th-rule input");
          var last = inputs[inputs.length - 2] || inputs[inputs.length - 1];
          if (last && last.focus) last.focus();
        });
      });
      rulesTitle.appendChild(addRule);
      panel.appendChild(rulesTitle);

      var rulesBox = el("div", "dsh-th-rules");
      config.rules.forEach(function (rule, index) {
        var row = el("div", "dsh-th-rule");

        var textInput = document.createElement("input");
        textInput.type = "text";
        textInput.value = rule.text;
        textInput.placeholder = "关键词";
        textInput.addEventListener("change", function () {
          rule.text = textInput.value.trim();
          commit();
          rebuildPanel();
        });

        var colorInput = document.createElement("input");
        colorInput.type = "color";
        colorInput.value = /^#[0-9a-f]{6}$/i.test(rule.color) ? rule.color : "#f5a524";
        colorInput.addEventListener("change", function () {
          rule.color = colorInput.value;
          commit();
        });

        var styleSelect = document.createElement("select");
        [
          ["text", "变色"],
          ["background", "底色"],
          ["underline", "下划线"],
        ].forEach(function (pair) {
          var option = document.createElement("option");
          option.value = pair[0];
          option.textContent = pair[1];
          styleSelect.appendChild(option);
        });
        styleSelect.value = rule.style;
        styleSelect.addEventListener("change", function () {
          rule.style = styleSelect.value;
          commit();
        });

        var remove = el("button", "dsh-th-mini", "✕");
        remove.title = "删除";
        remove.addEventListener("click", function () {
          config.rules.splice(index, 1);
          commit();
          rebuildPanel();
        });

        row.appendChild(textInput);
        row.appendChild(colorInput);
        row.appendChild(styleSelect);
        row.appendChild(remove);
        rulesBox.appendChild(row);
      });
      panel.appendChild(rulesBox);

      panel.appendChild(el("div", "dsh-th-sep"));

      var sentRow = el("div", "dsh-th-row");
      sentRow.appendChild(el("label", null, "整句触发"));
      var sentInput = document.createElement("input");
      sentInput.type = "text";
      sentInput.placeholder = "含这些词的整句上色，逗号分隔";
      sentInput.value = config.sentenceTriggers.join("，");
      sentInput.addEventListener("change", function () {
        config.sentenceTriggers = sentInput.value
          .split(/[,，\s]+/)
          .map(function (item) {
            return item.trim();
          })
          .filter(Boolean);
        commit();
      });
      sentRow.appendChild(sentInput);
      panel.appendChild(sentRow);

      var sentColorRow = el("div", "dsh-th-row");
      sentColorRow.appendChild(el("label", null, "整句颜色"));
      var sentColor = document.createElement("input");
      sentColor.type = "color";
      sentColor.value = /^#[0-9a-f]{6}$/i.test(config.sentenceColor) ? config.sentenceColor : "#7c9cff";
      sentColor.addEventListener("change", function () {
        config.sentenceColor = sentColor.value;
        commit();
      });
      sentColorRow.appendChild(sentColor);
      var sentStyle = document.createElement("select");
      [
        ["background", "底色"],
        ["text", "变色"],
        ["underline", "下划线"],
      ].forEach(function (pair) {
        var option = document.createElement("option");
        option.value = pair[0];
        option.textContent = pair[1];
        sentStyle.appendChild(option);
      });
      sentStyle.value = config.sentenceStyle;
      sentStyle.addEventListener("change", function () {
        config.sentenceStyle = sentStyle.value;
        commit();
      });
      sentColorRow.appendChild(sentStyle);
      panel.appendChild(sentColorRow);

      var actions = el("div", "dsh-th-actions");
      var resetBtn = el("button", null, "恢复默认");
      resetBtn.addEventListener("click", function () {
        config = normalizeConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
        commit();
        rebuildPanel();
      });
      var closeBtn = el("button", "dsh-th-primary", "完成");
      closeBtn.addEventListener("click", function () {
        togglePanel(false);
      });
      actions.appendChild(resetBtn);
      actions.appendChild(closeBtn);
      panel.appendChild(el("p", "dsh-th-hint", "颜色走 CSS Highlight，不会改动消息本身的 DOM。"));
      panel.appendChild(actions);

      return panel;
    }

    function rebuildPanel() {
      var wasOpen = Boolean(panelEl && panelEl.isConnected);
      if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
      panelEl = buildPanel();
      if (wasOpen) document.body.appendChild(panelEl);
    }

    function togglePanel(force) {
      if (!panelEl) panelEl = buildPanel();
      var shouldOpen = force === undefined ? !panelEl.isConnected : Boolean(force);
      if (shouldOpen) {
        rebuildPanel();
        document.body.appendChild(panelEl);
      } else if (panelEl.parentNode) {
        panelEl.parentNode.removeChild(panelEl);
      }
    }

    function ensureFab() {
      if (fabEl && fabEl.isConnected) return fabEl;
      fabEl = el("button", "dsh-th-fab", "Aa");
      fabEl.title = "正文高亮 / 字体";
      fabEl.setAttribute("data-dsh-th-ui", "1");
      fabEl.addEventListener("click", function () {
        togglePanel();
      });
      document.body.appendChild(fabEl);
      return fabEl;
    }

    /* -------------------------------------------------------------- 提交 */

    function commit() {
      writeLocalConfig(config);
      paintStyle();
      scheduleScan(null, true);
    }

    function start() {
      if (!document.body) return;

      ensureUiStyleElement().textContent = PANEL_CSS;

      var local = readLocalConfig();
      config = local || normalizeConfig(DEFAULT_CONFIG);
      paintStyle();
      ensureFab();
      observe();
      scheduleScan(null, true);
    }

    function apply(ctx) {
      window.__dshTextHighlight = {
        getConfig: function () {
          return config ? JSON.parse(JSON.stringify(config)) : null;
        },
        set: function (patch) {
          config = normalizeConfig(Object.assign({}, config || DEFAULT_CONFIG, patch || {}));
          commit();
        },
        reset: function () {
          config = normalizeConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
          commit();
        },
        rescan: function () {
          scheduleScan(null, true);
        },
      };

      ctx.effect(
        function () {
          var booted = false;
          var boot = function () {
            if (booted) return;
            booted = true;
            try {
              start();
            } catch (error) {
              console.error("[dsh-text-highlight] start failed", error);
            }
          };
          if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", boot, { once: true });
          } else {
            boot();
          }
          return function () {
            booted = true;
            if (observer) {
              observer.disconnect();
              observer = null;
            }
            if (scanTimer) {
              window.clearTimeout(scanTimer);
              scanTimer = 0;
            }
            clearHighlights();
            containerState.clear();
            if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
            if (fabEl && fabEl.parentNode) fabEl.parentNode.removeChild(fabEl);
            if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
            if (uiStyleEl && uiStyleEl.parentNode) uiStyleEl.parentNode.removeChild(uiStyleEl);
            panelEl = null;
            fabEl = null;
            styleEl = null;
            uiStyleEl = null;
            try {
              delete window.__dshTextHighlight;
            } catch (error) {
              window.__dshTextHighlight = undefined;
            }
          };
        },
        "dsh-text-highlight: paint",
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
