from pathlib import Path
import json,zipfile
p=Path(__file__).parent
templates={k:(p/'templates'/f'{k}.html').read_text() for k in ('dock','arcade')}
html=(p/'studio.html').read_text().replace('/*TEMPLATES*/','const templates='+json.dumps(templates).replace('</','<\\/')+';').replace('/*THEMES*/',(p/'theme.js').read_text())
(p/'Play.html').write_text(html)
with zipfile.ZipFile(p.parent/'Themed-AI-Arcade.zip','w',zipfile.ZIP_DEFLATED) as z:
 for n in ['Play.html','theme.js','studio.html','build.py','templates/dock.html','templates/arcade.html','README.md']:z.write(p/n,n)
