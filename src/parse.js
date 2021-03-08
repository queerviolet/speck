'use strict';

const path = require('path');
const grammar = require('./generated/grammar');
const visit = require('./visit');
const readFile = require('./file');
const importFigure = require('./figure');


module.exports = parse;

async function parse(filepath) {
  return await importAST(filepath, 'initialDocument');
}

async function importAST(filepath, startRule) {
  const source = await readFile(filepath)
  try {
    const ast = grammar.parse(source, { startRule });
    const importASTs = [];
    const importFigures = []
    visit(ast, function (node) {
      if (node.type === 'Import') {
        const subfilepath = path.resolve(
          path.dirname(filepath),
          decodeURI(node.path)
        );
        importASTs.push(importAST(subfilepath, 'importedDocument'));
      }
      if (node.type === 'ImportFigure') {
        const url = new URL('file://' + path.dirname(filepath) + '/' + node.path)
        importFigures.push(importFigure(node, url))
      }
    });
    const asts = await Promise.all(importASTs);
    await Promise.all(importFigures);
    return flattenDocuments(ast, asts);
  } catch (error) {
    if (error && error.line) {
      error.message =
        filepath + ':' + error.line + ':' + error.column + '\n' +
        source.split(/\r\n|\n|\r/g)[error.line - 1] + '\n' +
        Array(error.column).join(' ') + '^\n' +
        error.message;
    }
    throw error;
  }
}

/**
 * Returns a single AST from a collection of ASTs.
 */
function flattenDocuments(ast, asts) {
  let cursor = 0;
  const needToFlattenStack = [];
  let needToFlatten;
  return visit(ast, {
    leave: function (node, key, parent, keyPath) {
      if (needToFlatten !== undefined && keyPath.join('.') === needToFlatten) {
        node.contents = node.contents.reduce(flattener, []);
        needToFlatten = needToFlattenStack.pop();
      }
      if (node.type === 'Import') {
        const pathToFlatten = keyPath.slice(0, -1).join('.');
        if (pathToFlatten !== needToFlatten) {
          needToFlattenStack.push(needToFlatten);
          needToFlatten = pathToFlatten;
        }
        return asts[cursor++].contents;
      }
    }
  });
}

function flattener(array, item) {
  if (Array.isArray(item)) {
    return item.reduce(flattener, array);
  }
  array.push(item);
  return array;
}
