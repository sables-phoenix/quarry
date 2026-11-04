import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'
import { htmlToMarkdown } from 'mdream'
import { convert } from 'html-to-text'
import { getEncoding } from 'js-tiktoken'

const enc = getEncoding('o200k_base')
const tok = s => enc.encode(s).length

const urls = [
  'https://en.wikipedia.org/wiki/Markdown',
  'https://docs.python.org/3/library/json.html',
  'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch',
  'https://github.com/mozilla/readability',
  'https://peps.python.org/pep-0008/',
  'https://www.postgresql.org/docs/current/sql-select.html',
  'https://blog.cloudflare.com/',
  'https://news.ycombinator.com/',
]

const td = new TurndownService({ codeBlockStyle: 'fenced', headingStyle: 'atx' })
td.keep(['pre'])

const rows = []
for (const url of urls) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36' }, redirect: 'follow' })
    if (!res.ok) { console.log('SKIP', res.status, url); continue }
    const html = await res.text()
    const dom = new JSDOM(html, { url })
    const article = new Readability(dom.window.document).parse()
    const mainHtml = article?.content || ''
    const mainText = article?.textContent || ''
    const mdTurndown = mainHtml ? td.turndown(mainHtml) : ''
    let mdMdream = ''
    try { mdMdream = htmlToMarkdown(mainHtml, { minimal: true }) } catch (e) { mdMdream = '' }
    const plain = convert(html, { wordwrap: false })

    rows.push({
      url,
      htmlTok: tok(html),
      mainTextTok: tok(mainText),
      plainTextTok: tok(plain),
      mdTurndownTok: tok(mdTurndown),
      mdMdreamTok: tok(mdMdream),
      htmlChars: html.length,
      mdChars: mdTurndown.length,
    })
  } catch (e) { console.log('ERR', url, e.message) }
}

const pct = (a, b) => (100 * (1 - b / a))
console.log('\nurl | html_tok | readable_tok | plain_tok | md_turndown_tok | md_mdream_tok | md_cut_vs_html | readable_cut_vs_html')
for (const r of rows) {
  console.log([r.url, r.htmlTok, r.mainTextTok, r.plainTextTok, r.mdTurndownTok, r.mdMdreamTok,
    pct(r.htmlTok, r.mdTurndownTok).toFixed(1) + '%',
    pct(r.htmlTok, r.mainTextTok).toFixed(1) + '%'].join(' | '))
}
const med = arr => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
console.log('\nMEDIAN md vs html %:', med(rows.map(r => pct(r.htmlTok, r.mdTurndownTok))).toFixed(1))
console.log('MEDIAN readable vs html %:', med(rows.map(r => pct(r.htmlTok, r.mainTextTok))).toFixed(1))
console.log('MEDIAN md vs readable %:', med(rows.map(r => pct(r.mainTextTok, r.mdTurndownTok))).toFixed(1))
console.log('MEDIAN mdream vs turndown %:', med(rows.map(r => pct(r.mdTurndownTok, r.mdMdreamTok))).toFixed(1))
