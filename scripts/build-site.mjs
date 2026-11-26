// Writes the website (home, privacy, support, delete-data pages) (repo robert-whiteley/sidekick-site, served at
// https://robert-whiteley.github.io/sidekick-site/privacy) from docs/privacy-policy.md, the same text the app shows.
// Run after editing the policy: node scripts/build-site.mjs [path to sidekick-site]
// (default ../sidekick-site), then commit and push the site repo; GitHub Pages redeploys it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline markdown: **bold**, _em_, `code`, [text](url), bare https:// links. */
function inline(text) {
  let s = esc(text);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/(^|[\s(])(https:\/\/[^\s<)]+[^\s<).,])/g, '$1<a href="$2">$2</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/(^|\s)_([^_]+)_(?=\s|[.,]|$)/g, '$1<em>$2</em>');
  return s;
}

/** Small markdown subset used by the policy: headings, paragraphs, nested - and 1. lists. */
export function markdownToHtml(md) {
  const out = [];
  const stack = []; // open lists: { tag, indent }
  let para = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const closeTo = (indent) => {
    while (stack.length && stack[stack.length - 1].indent >= indent) {
      out.push(`</li></${stack.pop().tag}>`);
    }
  };
  for (const raw of md.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const h = /^(#{1,3}) (.*)$/.exec(line);
    const li = /^(\s*)([-*]|\d+\.) (.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      continue;
    }
    if (h) {
      flushPara();
      closeTo(0);
      const n = h[1].length;
      out.push(`<h${n}>${inline(h[2])}</h${n}>`);
    } else if (li) {
      flushPara();
      const indent = li[1].length;
      const tag = /\d/.test(li[2]) ? 'ol' : 'ul';
      const top = stack[stack.length - 1];
      if (top && top.indent > indent) closeTo(indent + 1);
      const cur = stack[stack.length - 1];
      if (cur && cur.indent === indent) out.push(`</li><li>${inline(li[3])}`);
      else {
        stack.push({ tag, indent });
        out.push(`<${tag}><li>${inline(li[3])}`);
      }
    } else if (stack.length && /^\s+/.test(line)) {
      // Continuation paragraph inside a list item.
      out.push(`<p>${inline(line.trim())}</p>`);
    } else {
      closeTo(0);
      para.push(line.trim());
    }
  }
  flushPara();
  closeTo(0);
  return out.join('\n');
}

export function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="google-site-verification" content="2Y94WToT5X8n6B3IKUJsqR5udXoecs95sTS3M4_5MfU">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/sidekick-site/style.css">
</head>
<body>
<header><a href="/sidekick-site/" class="brand">Sidekick</a>
<nav><a href="/sidekick-site/privacy/">Privacy</a> <a href="/sidekick-site/support/">Support</a> <a href="/sidekick-site/delete-data/">Delete data</a></nav></header>
<main>
${body}
</main>
<footer>Sidekick · <a href="mailto:info@sashy.ai">info@sashy.ai</a></footer>
</body>
</html>
`;
}

const HOME = `<h1>Sidekick</h1>
<p class="lead">An AI assistant that runs entirely on your Android phone. It sees and hears what you
choose, remembers it, and answers your questions, without sending your life to the cloud.</p>
<h2>What it does</h2>
<ul>
<li>Answers questions about what is in front of you, through the phone camera or a USB camera.</li>
<li>Remembers what you saw, heard and said, so you can ask later: "where did I put my keys?",
"what did Sam say about Friday?", "recap my last two hours".</li>
<li>Sets reminders, timers and calendar events, drafts messages and emails, and controls the phone
by voice.</li>
<li>Works offline, including in airplane mode.</li>
</ul>
<h2>Private by design</h2>
<ul>
<li>The AI models run on the phone. No accounts, no ads, no analytics, no tracking.</li>
<li>Your memories are kept in an encrypted database on the phone and never reach us. We have no
servers that receive your data.</li>
<li>Internet is used only to download the AI models, and for features you turn on yourself
(online lookup, weather, Gmail, Google Tasks, Google Drive backup).</li>
</ul>
<p>Get Sidekick on Google Play (link coming soon).</p>
<p><a href="/sidekick-site/privacy/">Privacy policy</a> · <a href="/sidekick-site/support/">Support</a> ·
<a href="/sidekick-site/delete-data/">Delete your data</a></p>`;

const SUPPORT = `<h1>Support</h1>
<p>Questions, problems or ideas: email <a href="mailto:info@sashy.ai">info@sashy.ai</a>.</p>
<p>In the app, <strong>Settings → About → Send feedback</strong> opens your email app with a draft.
It adds only the app version and phone model, and you can read and change it before sending.</p>
<p>Sidekick keeps everything on your phone, so we can't see your data. Please don't send anything
private unless you want to.</p>`;

const DELETE = `<h1>Delete your Sidekick data</h1>
<p>Sidekick has no accounts and keeps all your data on your phone, so there is nothing stored with
us to delete. You control it all on the phone:</p>
<ul>
<li><strong>Delete everything:</strong> in the app, Settings → Privacy → Delete everything. This
removes all memories, recordings, people, to-dos, settings and downloaded AI models, the same as
uninstalling.</li>
<li><strong>Delete some of it:</strong> Settings → Privacy lets you delete a time range, a person,
or a single item; Memory lets you delete any item.</li>
<li><strong>Uninstall:</strong> uninstalling Sidekick deletes all of its data from the phone.</li>
</ul>
<p>Files you saved or exported to your own folders, and a backup you chose to put in your Google
Drive, stay where you put them; delete them there. To remove Sidekick's access to your Google
account, go to <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</p>
<p>Questions: <a href="mailto:info@sashy.ai">info@sashy.ai</a>.</p>`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const site = resolve(process.argv[2] ?? join(root, '..', 'sidekick-site'));
  const md = readFileSync(join(root, 'docs/privacy-policy.md'), 'utf8');
  const pages = [
    ['index.html', 'Sidekick: a private AI assistant on your phone', HOME],
    ['privacy/index.html', 'Sidekick privacy policy', markdownToHtml(md)],
    ['support/index.html', 'Sidekick support', SUPPORT],
    ['delete-data/index.html', 'Delete your Sidekick data', DELETE],
  ];
  for (const [path, title, body] of pages) {
    mkdirSync(dirname(join(site, path)), { recursive: true });
    writeFileSync(join(site, path), page(title, body));
    console.log(`wrote ${join(site, path)}`);
  }
}
