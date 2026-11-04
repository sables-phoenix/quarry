import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { htmlToMarkdown } from 'mdream'
import { convert } from 'html-to-text'

const fixture = `
<article>
<h2>Install</h2>
<p>Run <code>pip install quarry</code> then:</p>
<pre><code class="language-python">def walk(node, depth=0):
    if node is None:
        return []
    # keep order
    out = [depth]
    for child in node.children:
        out.extend(walk(child, depth + 1))
    return out
</code></pre>
<h3>Highlighted variant (spans inside pre)</h3>
<pre><span class="k">def</span> <span class="nf">walk</span>(node, depth=<span class="mi">0</span>):
    <span class="k">if</span> node <span class="ow">is</span> <span class="kc">None</span>:
        <span class="k">return</span> []
</pre>
<h3>Table</h3>
<table>
<thead><tr><th>flag</th><th>meaning</th><th>default</th></tr></thead>
<tbody>
<tr><td><code>--fast</code></td><td>skip fallback | cascade</td><td>false</td></tr>
<tr><td><code>--precision</code></td><td>prefer precision</td><td>false</td></tr>
</tbody>
</table>
<ul><li>one<ul><li>nested a</li><li>nested b</li></ul></li><li>two</li></ul>
</article>`

const tdBare = new TurndownService({ codeBlockStyle: 'fenced', headingStyle: 'atx' })
const tdGfm = new TurndownService({ codeBlockStyle: 'fenced', headingStyle: 'atx' })
tdGfm.use(gfm)

const outs = {
  'turndown(default)': tdBare.turndown(fixture),
  'turndown(+gfm)': tdGfm.turndown(fixture),
  'mdream(minimal)': htmlToMarkdown(fixture, { minimal: true }),
  'mdream(full)': htmlToMarkdown(fixture),
  'html-to-text': convert(fixture, { wordwrap: false }),
}

const indent = s => s.split('\n').filter(l => /\S/.test(l) && /^( {4}|\t)/.test(l)).length
const checks = s => ({
  fenced: (s.match(/```/g) || []).length,
  lang: /```(python|py)/.test(s),
  indentedCodeLines: indent(s),
  tablePipes: (s.match(/^\|/gm) || []).length,
  nestedListMarkers: (s.match(/^ {2,}[-*] /gm) || []).length,
  hasPipInCell: /\| cascade/.test(s) || /cascade/.test(s),
})

for (const [k, v] of Object.entries(outs)) {
  console.log('\n===== ' + k + ' =====')
  console.log(JSON.stringify(checks(v)))
  console.log('---')
  console.log(v.slice(0, 900))
}
