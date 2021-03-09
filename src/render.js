const mermaid = require('headless-mermaid')
const visit = require('./visit');

const MERMAID_CONFIG = {
  theme: "dark",
  sequence: {
    showSequenceNumbers: true,
  },
}

module.exports = render

async function render(ast) {
  const renderings = []
  visit(ast, node => {
    if (node.type === 'Code' && node.diagram && node.lang === 'mermaid') {
      renderings.push(renderMermaid(node))
    }
  })
  await Promise.all(renderings)
  return ast
}

async function renderMermaid(node) {
  try {
    const svg = await mermaid.execute(node.code, MERMAID_CONFIG)
    node.lang = 'html'
    node.code = svg
  } catch(error) {
    console.error(error.message)
    node.lang = 'html'
    node.code = `<h1>Error rendering mermaid: ${error.message}</h1><pre><code>${error}</code></pre>`
  }
}
