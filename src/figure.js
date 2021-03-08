const {extname} = require('path');
const {parse} = require('graphql');
const readFile = require('./file');

module.exports = importFigure;

/**
 * Import code from a file, mutating the provided node into a Code node
 * which contains the imported content.
 * 
 * @param {*} node 
 * @param {URL} url 
 */
async function importFigure(node, url) {
  const lang = extname(url.pathname).slice(1);
  node.type = 'Code'
  node.lang = lang
  let text = await readFile(url.pathname)  
  if (MODELS[lang] && url.hash) {
    let region = {start:{line:0}}
    const regions = MODELS[lang](text)
    const [beginFrag, endFrag=beginFrag] = url.hash.slice(1).split('...')
    const startRegion = regions[beginFrag]
    if (startRegion) region.start = startRegion.start
    const endRegion = regions[endFrag]
    if (endRegion) region.end = endRegion.end
    text = text.split('\n')
      .slice(region.start.line, region.end == null ? undefined : region.end.line)
      .join('\n')
  }
  node.code = text;
}

/** Models **/

const MODELS = { graphql }

function graphql(text) {
  const ast = parse(text)
  const regions = {}
  let schemaIndex = 0
  for (const d of ast.definitions) {
    const name =
      d.kind === 'DirectiveDefinition'
        ? '@' + d.name.value 
        :
      d.kind === 'SchemaDefinition'
        ? `schema[${schemaIndex++}]`
        : d.name && d.name.value
    if (!name) continue
    regions[name] = {
      start: { line: d.loc.startToken.line - 1 },
      end: { line: d.loc.endToken.line },
    }

    for (const f of d.fields || []) {
      regions[name + '.' + f.name.value] = {
        start: { line: f.loc.startToken.line - 1 },
        end: { line: f.loc.endToken.line },          
      }
    }

    if (name.endsWith('[0]')) {
      regions[name.substr(0, name.length - '[0]'.length)] = regions[name]
    }
  }
  return regions
}