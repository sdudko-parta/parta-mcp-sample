#!/usr/bin/env node
/**
 * scripts/parse-page.mjs
 *
 * Read a markdown page, parse it to mdast (with GFM), and emit a deterministic
 * block plan keyed to the "Parta Quick-Start Collection" templates.
 *
 * Usage:
 *   node scripts/parse-page.mjs <path-to-page.md>
 *
 * Output (stdout, JSON):
 *   {
 *     "source": "<input path relative to cwd>",
 *     "assets": ["<repo-relative path>", ...],
 *     "blocks": [{ nodeKey, templateName, payload }, ...]
 *   }
 *
 * The skill consumes "blocks" to drive create_editor_block / update_editor_block
 * calls, and "assets" to know which files need create_s3_uploads first.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { toHast } from 'mdast-util-to-hast';
import { toHtml } from 'hast-util-to-html';

const [, , inputPath] = process.argv;
if (!inputPath) {
  console.error('usage: node scripts/parse-page.mjs <path-to-page.md>');
  process.exit(2);
}

const absPath = resolve(inputPath);
const pageDir = dirname(absPath);
const projectDir = resolve(pageDir, '..'); // page lives in <project>/pages/
const source = readFileSync(absPath, 'utf8');

const tree = unified().use(remarkParse).use(remarkGfm).parse(source);

// ----- helpers ----------------------------------------------------------

const counters = new Map();
const nextKey = (type) => {
  const i = counters.get(type) ?? 0;
  counters.set(type, i + 1);
  return `${type}#${i}`;
};

const mdastToHtml = (node) =>
  toHtml(toHast(node, { allowDangerousHtml: true }), { allowDangerousHtml: true });

const stripWrap = (html, tag) => {
  const open = new RegExp(`^<${tag}[^>]*>`);
  const close = new RegExp(`</${tag}>$`);
  return html.replace(open, '').replace(close, '');
};

const isImageOnlyParagraph = (node) =>
  node?.type === 'paragraph' &&
  node.children.length === 1 &&
  node.children[0].type === 'image';

const isStandaloneLinkParagraph = (node) =>
  node?.type === 'paragraph' &&
  node.children.length === 1 &&
  node.children[0].type === 'link';

const isDownloadable = (url) =>
  /\.(pdf|zip|csv|xlsx|xls|docx|doc|pptx|ppt)$/i.test(url);

const assets = new Set();
const resolveAsset = (url) => {
  if (/^https?:\/\//i.test(url)) return { external: true, url };
  const abs = resolve(pageDir, url);
  const ref = relative(resolve(projectDir, '..'), abs); // repo-relative
  assets.add(ref);
  return { external: false, ref };
};

const rotator = (variants) => {
  let i = 0;
  return () => variants[i++ % variants.length];
};
const h2Variant = rotator([
  'Heading 2',
  'Heading 2 with Caption',
  'Heading 2 with Divider',
  'Heading 2 with Icon',
]);
const dividerVariant = rotator([
  'Line Divider',
  'Color Divider',
  'Numbered Divider',
  'Double Divider',
]);

// ----- main pass --------------------------------------------------------

const root = tree.children;
const blocks = [];

for (let i = 0; i < root.length; i++) {
  const node = root[i];
  const next = root[i + 1];

  // --- headings -------------------------------------------------------
  if (node.type === 'heading') {
    const text = stripWrap(mdastToHtml(node), `h${node.depth}`);

    if (node.depth === 1) {
      if (next && next.type === 'paragraph' && !isImageOnlyParagraph(next)) {
        blocks.push({
          nodeKey: nextKey('h1'),
          templateName: 'Heading 1 with Caption',
          payload: { heading: text, caption: mdastToHtml(next) },
        });
        i++; // consumed the lead paragraph
      } else {
        blocks.push({
          nodeKey: nextKey('h1'),
          templateName: 'Heading 1',
          payload: { heading: text },
        });
      }
      continue;
    }

    if (node.depth === 2) {
      const tpl = h2Variant();
      const wantCaption = tpl === 'Heading 2 with Caption';
      if (wantCaption && next?.type === 'paragraph' && !isImageOnlyParagraph(next)) {
        blocks.push({
          nodeKey: nextKey('h2'),
          templateName: tpl,
          payload: { heading: text, caption: mdastToHtml(next) },
        });
        i++;
      } else {
        blocks.push({
          nodeKey: nextKey('h2'),
          templateName: tpl === 'Heading 2 with Caption' ? 'Heading 2' : tpl,
          payload: { heading: text },
        });
      }
      continue;
    }

    blocks.push({
      nodeKey: nextKey('h3'),
      templateName: 'Heading 3',
      payload: { heading: text },
    });
    continue;
  }

  // --- standalone image ----------------------------------------------
  if (isImageOnlyParagraph(node)) {
    const img = node.children[0];
    blocks.push({
      nodeKey: nextKey('image'),
      templateName: img.alt ? 'Image with Caption' : 'Image',
      payload: {
        asset: resolveAsset(img.url),
        alt: img.alt ?? '',
        caption: img.alt ?? '',
      },
    });
    continue;
  }

  // --- paragraph + adjacent image-only paragraph ---------------------
  if (
    node.type === 'paragraph' &&
    !isImageOnlyParagraph(node) &&
    isImageOnlyParagraph(next)
  ) {
    const img = next.children[0];
    blocks.push({
      nodeKey: nextKey('text-image'),
      templateName: 'Text with Image (Right)',
      payload: {
        text: mdastToHtml(node),
        asset: resolveAsset(img.url),
        alt: img.alt ?? '',
      },
    });
    i++;
    continue;
  }

  // --- standalone link paragraph -------------------------------------
  if (isStandaloneLinkParagraph(node)) {
    const link = node.children[0];
    const label = stripWrap(mdastToHtml(link), 'a');
    if (isDownloadable(link.url)) {
      blocks.push({
        nodeKey: nextKey('downloader'),
        templateName: 'Downloader',
        payload: { asset: resolveAsset(link.url), label },
      });
    } else {
      blocks.push({
        nodeKey: nextKey('link'),
        templateName: 'Link',
        payload: { url: link.url, label },
      });
    }
    continue;
  }

  // --- plain paragraph -----------------------------------------------
  if (node.type === 'paragraph') {
    blocks.push({
      nodeKey: nextKey('p'),
      templateName: 'Text',
      payload: { richText: mdastToHtml(node) },
    });
    continue;
  }

  // --- lists ---------------------------------------------------------
  if (node.type === 'list') {
    const tpl = node.ordered ? 'Numbered List' : 'Bullet List';
    const items = node.children.map((li) => {
      const html = mdastToHtml(li);
      return stripWrap(stripWrap(html, 'li'), 'p').trim();
    });
    blocks.push({
      nodeKey: nextKey(node.ordered ? 'ol' : 'ul'),
      templateName: tpl,
      payload: { items },
    });
    continue;
  }

  // --- fenced code ---------------------------------------------------
  if (node.type === 'code') {
    blocks.push({
      nodeKey: nextKey('code'),
      templateName: 'Code Snippet',
      payload: {
        language: node.lang ?? 'text',
        code: node.value,
      },
    });
    continue;
  }

  // --- blockquote ----------------------------------------------------
  if (node.type === 'blockquote') {
    const html = mdastToHtml(node);
    const attrib = html.match(/—\s*([^<]+)<\/p>\s*$/);
    blocks.push({
      nodeKey: nextKey('quote'),
      templateName: attrib ? 'Quote 4' : 'Statement 1',
      payload: {
        text: html,
        author: attrib ? attrib[1].trim() : null,
      },
    });
    continue;
  }

  // --- GFM table -----------------------------------------------------
  if (node.type === 'table') {
    const rows = node.children.map((row) =>
      row.children.map((cell) => {
        const html = mdastToHtml(cell);
        return stripWrap(stripWrap(html, 'th'), 'td');
      })
    );
    blocks.push({
      nodeKey: nextKey('table'),
      templateName: 'Table',
      payload: { header: rows[0], rows: rows.slice(1) },
    });
    continue;
  }

  // --- raw HTML / iframe → embed -------------------------------------
  if (node.type === 'html') {
    blocks.push({
      nodeKey: nextKey('embed'),
      templateName: 'Embed Code',
      payload: { html: node.value },
    });
    continue;
  }

  // --- horizontal rule -----------------------------------------------
  if (node.type === 'thematicBreak') {
    blocks.push({
      nodeKey: nextKey('divider'),
      templateName: dividerVariant(),
      payload: {},
    });
    continue;
  }

  // --- fallback ------------------------------------------------------
  blocks.push({
    nodeKey: nextKey('unknown'),
    templateName: 'Text',
    payload: { richText: mdastToHtml(node) },
  });
}

const out = {
  source: relative(process.cwd(), absPath),
  assets: [...assets],
  blocks,
};

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
