"""Public, dated gallery copy. Refresh only index.html; archives are immutable."""
import argparse
import html
import json
from pathlib import Path
import re

COPY = Path(__file__).resolve().parents[2] / 'docs/integration/public-gallery-copy.json'
PITT = 'https://sites.pitt.edu/~goscilo/Sci-Fi/FilmStills/TheTerminator.html'
STYLE = '''html{background:white;color:black;scroll-behavior:auto}
body{font-family:"Times New Roman",Times,serif;font-size:17px;line-height:1.3;max-width:1160px;margin:24px auto;padding:0 18px;overflow-wrap:anywhere}
a{color:#0000ee}a:visited{color:#551a8b}
h1{font-size:32px;line-height:1.08;margin:24px 0 8px}h2{font-size:24px;margin:28px 0 8px}h3{font-size:20px;margin:20px 0 6px}
p{margin:8px 0 12px}li{margin:5px 0}ul{padding-left:24px}
hr{border:0;border-top:1px solid #888;margin:18px 0}nav{margin:12px 0}
small,.dateline,figcaption{font-size:15px}.status{color:black}
.story{margin:24px 0;padding:0 0 12px;border-bottom:1px solid #aaa}
.story blockquote{margin:12px 0 24px;padding:0 0 0 18px;border-left:1px solid #999;white-space:pre-wrap;overflow-wrap:anywhere}
details{margin:12px 0}summary{cursor:pointer}.jump-links{display:flex;flex-wrap:wrap;gap:8px 24px}
.comparison{max-width:100%;overflow-x:auto}.views,.columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;min-width:750px}
.columns{position:static;padding:8px 0;border-top:1px solid #888;border-bottom:1px solid #888;font-weight:bold}
.comparison section{margin:24px 0}.comparison h2{font-size:20px;margin:16px 0 8px}
figure{margin:0;min-width:0}figure>a{display:block}img{display:block;width:100%;height:auto}figcaption{margin-top:5px}
pre{font:13px/1.3 "Courier New",monospace;white-space:pre-wrap;overflow-wrap:anywhere}code{overflow-wrap:anywhere}
a:focus-visible{outline:2px solid #0000ee;outline-offset:3px}#compare-five-views,#original-prompt{scroll-margin-top:16px}
footer.story{font-size:14px;border-bottom:0}
@media(max-width:640px){body{margin:16px auto;padding:0 12px}h1{font-size:28px}.story blockquote{padding-left:12px}}'''


def load_copy(path=COPY):
    data = json.loads(Path(path).read_text())
    if data['schema'] != 'v2-public-gallery-copy-1':
        raise ValueError('Unrecognized public copy schema')
    return data


def marked(name, body):
    return f'<!-- public-gallery:{name}:start -->{body}<!-- public-gallery:{name}:end -->'


def platform_footer(document):
    footer = '<footer class="story"><p><a href="/agents.md">Make your own</a></p></footer>'
    if '<!-- public-gallery:platform:start -->' not in document:
        document = document.replace('</body>', marked('platform', footer) + '</body>', 1)
    return document


def restyle(document):
    """Use shared report CSS; historical callers pass export copies only."""
    document = re.sub(r'<!-- public-gallery:style:start -->.*?<!-- public-gallery:style:end -->', '', document, flags=re.S)
    document = re.sub(r'<style\b[^>]*>.*?</style>', '', document, flags=re.S)
    document = document.replace('<span>New target</span>', '<span>V2 target</span>')
    return document.replace('</head>', marked('style', '<style>' + STYLE + '</style>') + '</head>', 1)


def decorate(document, copy=None, copy_href='public-copy.json'):
    """Idempotent decoration: dated copy does not claim to review future captures."""
    data = copy or load_copy()
    esc = html.escape
    for name in ('style', 'intro', 'appendix', 'platform'):
        document = re.sub(rf'<!-- public-gallery:{name}:start -->.*?<!-- public-gallery:{name}:end -->', '', document, flags=re.S)
    intro = '<nav class="jump-links" aria-label="Page sections"><a href="#compare-five-views">Compare five views</a><a href="#original-prompt">Read the original prompt</a></nav>'
    intro += '<section class="story" aria-labelledby="progress-recap"><h2 id="progress-recap">' + esc(data['recap_title']) + '</h2>'
    intro += '<ul class="recap">' + ''.join('<li>' + esc(p) + '</li>' for p in data['recap']) + '</ul></section>'
    appendix = '<section class="story" aria-labelledby="original-prompt"><h2 id="original-prompt">The original prompt</h2><p>' + esc(data['source_note']) + '</p>'
    # Lead with the actual refactor prompt. The earlier asset request is context.
    excerpts = sorted(data['excerpts'], key=lambda x: x['id'] == 'initial-assets')
    for item in excerpts:
        initial = item['id'] == 'initial-assets'
        label = esc(item['label'])
        appendix += ('<details><summary>' + label + '</summary>') if initial else ('<h3>' + label + '</h3>')
        appendix += f'<p class="dateline"><time datetime="{esc(item["timestamp"])}">{esc(item["timestamp"])}</time> · session line {item["line"]}'
        if item.get('omission'):
            appendix += ' · ' + esc(item['omission'])
        text = esc(item['text']).replace(esc(PITT), f'<a href="{PITT}">{PITT}</a>')
        appendix += f'</p><blockquote data-excerpt="{esc(item["id"])}">{text}</blockquote>'
        if initial:
            appendix += '</details>'
    appendix += f'<p><a href="{esc(copy_href)}">Public source of this copy</a> · <a href="#compare-five-views">Back to the five views</a></p></section>'
    document = restyle(document)
    document = document.replace('<body>', '<body>' + marked('intro', intro), 1)
    if 'id="compare-five-views"' not in document:
        document = document.replace('<div class="comparison">', '<div class="comparison" id="compare-five-views">', 1)
    return platform_footer(document.replace('</body>', marked('appendix', appendix) + '</body>', 1))


def refresh(gallery):
    gallery = Path(gallery)
    history = json.loads((gallery / 'history.json').read_text())
    if not any(item['id'] == history['latest'] for item in history['milestones']):
        raise ValueError('Missing latest milestone')
    index = gallery / 'index.html'
    index.write_text(decorate(index.read_text()))
    (gallery / 'public-copy.json').write_bytes(COPY.read_bytes())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('gallery', type=Path)
    refresh(parser.parse_args().gallery)
