const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const prism = require('prismjs');
const visit = require('./visit');

function print(ast, _options) {
  const options = {
    highlight: _options && _options.highlight || highlight,
    biblio: _options && _options.biblio && buildBiblio(_options.biblio) || {},
    head: _options && _options.head || '',
  };
  validateSecIDs(ast, options);
  assignExampleNumbers(ast, options);
  assignBiblioIDs(ast, options);
  return (
    '<!DOCTYPE html>\n' +
    '<!-- Built with spec-md https://spec-md.com -->\n' +
    '<html>\n' +
      '<head>' + printHead(ast, options) + '</head>\n' +
      '<body>' + printBody(ast, options) + '</body>\n' +
    '</html>\n'
  );
};

module.exports = print;

function highlight(code, lang) {
  const prismLang = getPrismLanguage(lang);
  try {
    return prismLang ? prism.highlight(code, prismLang) : escapeCode(code);
  } catch (error) {
    return escapeCode(code);
  }
}

function getPrismLanguage(lang) {
  if (!lang) {
    return lang;
  }
  // If this language isn't in the list, it might not be loaded yet.
  if (!prism.languages[lang]) {
    loadAllLanguages();
  }
  return prism.languages[lang];
}

// Unfortuantely, Prism does not export all of its languages by default, so
// this function does so. Its memoized so it is only executed once.
var hasLoadedAllLanguages;
function loadAllLanguages() {
  if (hasLoadedAllLanguages) {
    return
  }
  hasLoadedAllLanguages = true;
  const prismComponents = require('prismjs/components.json')
  const componentsDir = path.join(path.dirname(require.resolve('prismjs')), 'components');
  const langPaths = {};
  for (const lang of Object.keys(prismComponents.languages)) {
    if (lang !== 'meta') {
      langPaths[lang] = path.join(componentsDir, `prism-${lang}.js`);
    }
  }

  // Load every language into Prism.
  Object.keys(langPaths).forEach(loadLanguage);

  // Load extended dependencies first.
  function loadLanguage(lang) {
    if (prism.languages[lang]) {
      return;
    }
    const langPath = langPaths[lang];
    const requiresLang = prismComponents.languages[lang].require
    if (requiresLang) {
      if (Array.isArray(requiresLang)) {
        requiresLang.forEach(loadLanguage)
      } else {
        loadLanguage(requiresLang)
      }
    }
    require(langPath);
  }
}

function printHead(ast, options) {
  return (
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + (ast.title ? ast.title.value : 'Spec') + '</title>\n' +
    '<style>\n' + readStatic('client/spec.css') + '</style>\n' +
    '<style>\n' + readPrismCSS() + '</style>\n' +
    execStaticJS('generated/highlightName.js') +
    execStaticJS('generated/linkSelections.js') +
    options.head
  );
}

function printBody(ast, options) {
  return (
    '<article>\n' +
      '<header>\n' +
        printTitle(ast) +
        printIntro(ast, options) +
        printTOC(ast, options) +
      '</header>\n' +
      printContent(ast, options) +
      printIndex(ast, options) +
    '</article>\n' +
    '<footer>\n' +
      'Written in <a href="https://spec-md.com" target="_blank">Spec Markdown</a>.' +
    '</footer>\n' +
    printSidebar(ast, options) +
    execStaticJS('generated/mermaid.js')
  );
}

function printTitle(ast) {
  return !ast.title ? '' : (
    '<h1>' + escape(ast.title.value) + '</h1>\n'
  );
}

function buildBiblio(ref) {
  const biblio = {};
  for (const site of Object.keys(ref)) {
    for (const id of Object.keys(ref[site])) {
      biblio[id] = site + ref[site][id];
    }
  }
  return biblio;
}

function validateSecIDs(ast, options) {
  let sectionIDPart = 0;
  const sectionIDStack = [];

  const items = visit(ast, {
    enter: function (node) {
      if (node.type === 'Section') {
        if (node.secID) {
          let nextIDPart = node.secID[node.secID.length - 1];
          const nextIsLetter = IS_LETTER_RX.test(nextIDPart);
          if (nextIDPart === '*') {
            throw new Error('Not yet supported');
          } else if (!nextIsLetter) {
            nextIDPart = parseInt(nextIDPart, 10);
          }
          if (!nextIsLetter && IS_LETTER_RX.test(sectionIDPart)) {
            throw new Error(
              'Cannot change to numbered section ' + nextIDPart +
              ' after lettered section ' + sectionIDPart
            );
          } else if (!nextIsLetter && nextIDPart <= sectionIDPart) {
            throw new Error(
              'Cannot change to section number ' + nextIDPart +
              ' which would be earlier than ' + nextSecID(sectionIDPart)
            );
          }
          sectionIDPart = nextIDPart;
        } else {
          sectionIDPart = nextSecID(sectionIDPart);
        }
        sectionIDStack.push(sectionIDPart);
        sectionIDPart = 0;
        // Copy the validatd secID stack at this point.
        node.secID = sectionIDStack.slice();
      }
    },
    leave: function (node) {
      if (node.type === 'Section') {
        sectionIDPart = sectionIDStack.pop();
      }
      return '';
    }
  });
}

function assignExampleNumbers(ast, options) {
  let exampleNum = 1;
  visit(ast, {
    enter(node) {
      if (node.type === 'Code' && node.example) {
        node.number = exampleNum++;
      }
    }
  });
}

function assignBiblioIDs(ast, options) {
  const secnames = {};
  const conflicts = {};
  const secnameStack = [];
  const defnameStack = [];
  visit(ast, function (node) {
    if (node.type === 'Section') {
      const secname = anchorize(node.title);
      if (secnames.hasOwnProperty(secname)) {
        conflicts[secname] = true;
      } else {
        secnames[secname] = true;
      }
    }
  });

  const hashUsed = {};
  visit(ast, {
    enter: function (node) {
      if (node.type === 'Section') {
        let secname = anchorize(node.title);
        if (conflicts.hasOwnProperty(secname)) {
          secname = secnameStack[secnameStack.length - 1] + '.' + secname;
        }
        let id = node.definition
          ? (defnameStack.push(anchorizeDefinition(node.title)),
            defnameStack.join('.'))
          : 'sec-' + secname;
        if (!options.biblio[id]) {
          options.biblio[id] = '#' + id;
        }
        node.id = id;
        secnameStack.push(secname);
      }
      if (node.type === 'Subsection') {
        let subsecname = anchorize(node.title);
        let secname = secnameStack.length > 0
          ? secnameStack[secnameStack.length - 1] + '.' + subsecname
          : subsecname;
        let id = 'sec-' + secname;
        if (!options.biblio[id]) {
          options.biblio[id] = '#' + id;
        }
        node.id = id;
      }
      if (node.type === 'Algorithm') {
        let id = anchorize(node.call.name) + '()';
        if (!options.biblio[id]) {
          options.biblio[id] = '#' + id;
        }
        node.id = id;
      }
      if (node.type === 'Production' || node.type === 'OneOfProduction') {
        let id = anchorize(node.token.name);
        if (!options.biblio[id]) {
          options.biblio[id] = '#' + id;
        }
        node.id = id;
      }
      if (node.type === 'Code') {
        if (node.title) {
          const baseId = anchorize(
            (node.example ? 'example-' : 'fig-') +
            textContent(node.title).trim()
          );
          let id = baseId
          for (let i = 2; options.biblio[id]; ++i) {
            id = baseId + '-' + i
          }
          options.biblio[id] = '#' + id;
          node.id = id;
          return
        }
        let id;
        let hash = '';
        do {
          hash = stableCodeHash(hash + node.code);
        } while (hashUsed[hash]);
        hashUsed[hash] = true;
        let hashSize = 5;
        do {
          id = anchorize('example-' + hash.slice(0, hashSize++));
        } while (options.biblio[id] && hashSize < 32);
        options.biblio[id] = '#' + id;
        node.id = id;
      }
      if (node.type === 'Note') {
        let content = printAll(node.contents, options);
        let id;
        let hash = '';
        do {
          hash = stableContentHash(hash + content);
        } while (hashUsed[hash]);
        hashUsed[hash] = true;
        let hashSize = 5;
        do {
          id = anchorize('note-' + hash.slice(0, hashSize++));
        } while (options.biblio[id] && hashSize < 32);
        options.biblio[id] = '#' + id;
        node.id = id;
      }
    },
    leave: function (node) {
      if (node.type === 'Section') {
        secnameStack.pop();
        if (node.definition)
          defnameStack.pop();
      }
    }
  });
}

const IS_LETTER_RX = /^[A-Z]+$/;

function nextSecID(id) {
  const isLetter = IS_LETTER_RX.test(id);
  if (!isLetter) {
    return id + 1;
  }

  // A -> B, Z -> AA, AA -> AB, ZZ -> AAA
  const letters = id.split('');
  const numB26 = '1' + letters.map(ch => (ch.charCodeAt(0) - 65).toString(26)).join('');
  const nextDigitsB26 = (parseInt(numB26, 26) + 1).toString(26).split('');
  return nextDigitsB26.map((digit, index) => {
    if (index === 0) return digit === '1' ? '' : 'A';
    return String.fromCharCode(parseInt(digit, 26) + 65);
  }).join('');
}


// Table of Contents

function printTOC(ast, options) {
  const sections = ast.contents.filter(content => content.type === 'Section');

  const items = visit(sections, {
    leave: function (node) {
      if (node.type === 'Section') {
        const subSections = join(node.contents);
        const secID = join(node.secID, '.');
        return (
          '<li>' +
            '<a href="' + options.biblio[node.id] + '">' +
              '<span class="spec-secid">' + secID + '</span>' +
              escape(node.title) +
            '</a>' +
            (subSections && '<ol>\n' + subSections + '</ol>\n') +
          '</li>\n'
        );
      }
      return '';
    }
  });

  if (hasIndex(ast, options)) {
    items.push('<li><a href="#index"><span class="spec-secid">§</span>Index</a></li>\n');
  }

  return (
    '<nav class="spec-toc">\n' +
      '<div class="title">Contents</div>\n' +
      '<ol>\n' + join(items) + '</ol>\n' +
    '</nav>\n'
  );
}


// Sidebar

function printSidebar(ast, options) {
  const sections = ast.contents.filter(content => content.type === 'Section');

  const items = visit(sections, {
    leave: function (node) {
      if (node.type === 'Section') {
        const subSections = join(node.contents);
        const secID = join(node.secID, '.');
        return (
          '<li id="_sidebar_' + secID + '">' +
            '<a href="' + options.biblio[node.id] + '">' +
              '<span class="spec-secid">' + join(node.secID, '.') + '</span>' +
              escape(node.title) +
            '</a>' +
            (subSections &&
              '\n<input hidden class="toggle" type="checkbox" id="_toggle_' + secID + '" />' +
              '<label for="_toggle_' + secID + '"></label>\n' +
              '<ol>\n' + subSections + '</ol>\n') +
          '</li>\n'
        );
      }
      return '';
    }
  });

  if (hasIndex(ast, options)) {
    items.push('<li id="_sidebar_index"><a href="#index"><span class="spec-secid">§</span>Index</a></li>\n');
  }

  return (
    '<input hidden class="spec-sidebar-toggle" type="checkbox" id="spec-sidebar-toggle" aria-hidden />' +
    '<label for="spec-sidebar-toggle" aria-hidden><div class="spec-sidebar-button">&#x2630;</div></label>\n' +
    '<div class="spec-sidebar" aria-hidden>\n' +
      '<div class="spec-toc">\n' +
        '<div class="title"><a href="#">' + escape(ast.title.value) + '</a></div>\n' +
        '<ol>' + join(items) + '</ol>\n' +
      '</div>\n' +
      execStaticJS('generated/sidebar.js') +
    '</div>\n'
  );
}

function textContent(input, separator = ' ') {
  if (!input) return ''
  if (typeof input === 'string') return input
  if (Array.isArray(input)) return input.map(textContent).join(' ')
  return textContent(input.title || input.contents || input.name || input.value)
}

// Content

function printIntro(doc, options) {
  const intro = doc.contents.filter(content => content.type !== 'Section');
  return intro.length === 0 ? '' :
    '<section id="intro">\n' +
      printAll(intro, options) +
    '</section>\n';
}

function printContent(doc, options) {
  const sections = doc.contents.filter(content => content.type === 'Section');
  return printAll(sections, options);
}

function printAll(list, options) {
  return join(visit(list, {
    leave: function (node) {
      switch (node.type) {
        case 'Section': {
          const level = Math.min(node.secID.length, 6);
          const secID = join(node.secID, '.');
          return (
            '<section id="' + node.id + '" secid="' + secID + '">\n' +
              '<h' + level + (node.definition ? ' class="spec-definition-head">' : '>') +
              '<span class="spec-secid" title="link to this section">' +
                '<a href="' + options.biblio[node.id] + '">' + secID + '</a>' +
              '</span>' +
              escape(node.title) +
              '</h' + level + '>\n' +
              join(node.contents) +
            '</section>\n'
          );
        }

        case 'Subsection':
          return (
            '<section id="' + node.id + '" class="subsec">\n' +
              '<h6>' +
                '<a href="' + options.biblio[node.id] + '" title="link to this subsection">' +
                  escape(node.title) +
                '</a>' +
              '</h6>\n' +
              join(node.contents) +
            '</section>\n'
          );

        case 'BlockIns':
          return '<div class="spec-added">' + join(node.contents) + '</div>\n';

        case 'BlockDel':
          return '<div class="spec-removed">' + join(node.contents) + '</div>\n';

        case 'Paragraph':
          return '<p>' + join(node.contents) + '</p>\n';

        case 'Requirement':
          return (
            `<a href="${node.url}" class="spec-requirement${node.negated ? ' not ' : ' '}${node.strength}">` +
                node.text +
            '</a>'
          );

        case 'Text':
          return formatText(node.value);

        case 'Bold':
          return '<strong>' + join(node.contents) + '</strong>';

        case 'Italic':
          return '<em>' + join(node.contents) + '</em>';

        case 'Note':
          return (
            '<div id="' + node.id + '" class="spec-note">\n' +
              '<a href="#' + node.id + '">Note</a>\n' +
              join(node.contents) +
            '</div>\n'
          );

        case 'Todo':
          return '<div class="spec-todo">\n' + join(node.contents) + '</div>\n';

        case 'HTMLBlock':
          return node.html;

        case 'HTMLTag':
          return node.tag;

        case 'Ins':
          return '<ins>' + join(node.contents) + '</ins>';

        case 'Del':
          return '<del>' + join(node.contents) + '</del>';

        case 'Code':
          return printCode(node, options);

        case 'InlineCode':
          return '<code>' + escapeCode(node.code) + '</code>';

        case 'Link': {
          const url = resolveLinkUrl(node.url, options);
          return '<a href="' + encodeURI(url) + '">' + join(node.contents) + '</a>';
        }

        case 'Image':
          return (
            '<img src="' + encodeURI(node.url) + '"' +
              (node.alt ? ' alt="' + escape(node.alt) + '"' : '') +
            '/>'
          );

        case 'List': {
          const olul = node.ordered ? 'ol' : 'ul';
          return '<' + olul + '>\n' + join(node.items) + '</' + olul + '>\n';
        }

        case 'ListItem':
          return '<li>' + join(node.contents) + '</li>\n';

        case 'TaskListItem':
          return (
            '<li class="task">\n' +
              '<input type="checkbox" disabled' + (node.done ? ' checked' : '') +  '>\n' +
              join(node.contents) +
            '</li>\n'
          );

        case 'Table':
          return (
            '<table>\n' +
              '<thead><tr>\n' +
                join(node.headers.map(cell => '<th>' + join(cell) + '</th>\n')) +
              '</tr></thead>\n' +
              '<tbody>\n' +
                join(node.rows.map(row =>
                  '<tr>\n' +
                    join(row.map(cell => '<td>' + join(cell) + '</td>')) +
                  '</tr>\n'
                )) +
              '</tbody>\n' +
            '</table>\n'
          );

        case 'Algorithm':
          return (
            '<div class="spec-algo" id="' + node.id + '">\n' +
              node.call +
              node.steps +
            '</div>\n'
          );

        case 'Call':
          return (
            '<span class="spec-call">' +
              link(node, options, true) +
              (node.args ? '(' + join(node.args, ', ') + ')' : '') +
            '</span>'
          );

        case 'Keyword':
          return '<span class="spec-keyword">' + node.value + '</span>';

        case 'StringLiteral':
          return '<span class="spec-string">' + node.value + '</span>';

        case 'Variable':
          return '<var data-name="' + anchorize(node.name) + '">' + node.name + '</var>';

        case 'Semantic': {
          const defType = node.defType === 1 ? '' : ' d' + node.defType;
          return (
            '<div class="spec-semantic' + defType + '">\n' +
              node.name +
              node.rhs +
              node.steps +
            '</div>\n'
          );
        }

        case 'Production': {
          const defType = node.defType === 1 ? '' : ' d' + node.defType;
          return (
            '<div class="spec-production' + defType + '" id="' + node.id + '">\n' +
              node.token +
              node.rhs +
            '</div>\n'
          );
        }

        case 'OneOfRHS':
          return (
            '<div class="spec-oneof">' +
              '<div class="spec-oneof-grid">' +
                '<table>\n' +
                  join(node.rows.map(row =>
                    '<tr>\n' +
                      join(row.map(def => '<td class="spec-rhs">' + def + '</td>')) +
                    '</tr>\n'
                  )) +
                '</table>' +
              '</div>' +
            '</div>\n'
          );

        case 'ListRHS':
          return join(node.defs);

        case 'RHS':
          return (
            '<div class="spec-rhs">' +
              maybe(node.condition) +
              join(node.tokens) +
            '</div>\n'
          );

        case 'Condition':
          return (
            '<span class="spec-condition' + (node.not ? ' not' : '') + '">' +
              node.param +
            '</span>'
          );

        case 'Prose':
          return '<span class="spec-prose">' + escape(node.text) + '</span>';

        case 'NonTerminal':
          return (
            '<span class="spec-nt' +
              (node.isList ? ' list' : '') +
              (node.isOptional ? ' optional' : '') +
            '">' +
              link(node, options, true) +
              (node.params ? '<span class="spec-params">' + join(node.params) + '</span>' : '') +
            '</span>'
          );

        case 'NonTerminalParam':
          return (
            '<span class="spec-param' +
              (node.negated ? ' negated' : node.conditional ? ' conditional' : '') +
            '">' +
              node.name +
            '</span>'
          );

        case 'Quantified': {
          const quantifiers =
            (node.isList ? '<span class="spec-quantifier list">list</span>' : '') +
            (node.isOptional ? '<span class="spec-quantifier optional">opt</span>' : '');
          return (
            '<span class="spec-quantified">' +
              node.token +
              '<span class="spec-quantifiers">' + quantifiers + '</span>' +
            '</span>'
          );
        }

        case 'Constrained':
          return (
            '<span class="spec-constrained">' +
              node.token +
              node.constraint +
            '</span>'
          );

        case 'Empty':
          return '<span class="spec-empty">[empty]</span>';

        case 'Lookahead':
          return (
            '<span class="spec-lookahead'+
              (node.set.length > 1 ? ' set' : node.nt ? ' ntset' : '') +
              (node.not ? ' not' : '') +
            '">'+
              join(node.set) +
            '</span>'
          );

        case 'ButNot':
          return '<span class="spec-butnot">' + join(node.tokens) + '</span>';

        case 'RegExp':
          return '<span class="spec-rx">' + escape(node.value) + '</span>';

        case 'Terminal':
          return '<span class="spec-t">' + escape(node.value) + '</span>';

        default:
          throw new Error('Unknown AST node: ' + node.type + ' ' + node);
      }

    }
  }));
}

function printCode(node, options) {
  if (node.raw && node.lang === 'html')
    return node.code
  return '<figure' +
      (node.id ? ' id="' + node.id + '"' : '') +
      (node.counter ? ' class="spec-counter-example"' : node.example ? ' class="spec-example"' : '') +
      (node.definition ? ' class="spec-definition"' : '') +
    '>' +
      printFigCaption(node, options) +
      printFigBody(node, options) +
    '</figure>'
}

function printFigCaption(node, options) {
  if (!node.example && !node.title) return ''
  const example = node.example
    ? '<span class="spec-example-num">' + (
      node.counter ? 'Counter Example № ' : 'Example № '
      ) +  node.number + '</span>'
    : ''
  const title = join(node.title)

  return '<figcaption>' + linkTo(node.id, example + title, options) + '</figcaption>'
}

function printFigBody(node, options) {
  if (node.diagram) {
    if (node.lang === 'html')
      return node.code
    if (node.lang === 'mermaid')
      return `<div class=mermaid>${node.code}</div>`
  }

  return `<pre${node.lang ? ` class="${node.lang}" data-language="${node.lang}"` : ''}><code>` +
    options.highlight(node.code, node.lang) +
  '</code></pre>\n'
}

const getTerms = require('@protoplasm/recall').default (
  function getTerms(ast) {
    const terms = {};
    const sectionIDs = [];
    // visit(ast, {
    //   enter(node) {
    //     if (node.type === 'Section') {
    //       sectionIDs.push(node.secID);
    //     }
    //     // Do not include terms defined in an appendix.
    //     if (IS_LETTER_RX.test(sectionIDs[0])) {
    //       return;
    //     }
    //     if (node.type === 'Algorithm') {
    //       const algorithmName = node.call.name;
    //       if (!terms[algorithmName]) {
    //         terms[algorithmName] = node;
    //       }
    //     } else if (node.type === 'Production' || node.type === 'OneOfProduction') {
    //       const productionName = node.token.name;
    //       if (!terms[productionName]) {
    //         terms[productionName] = node;
    //       }
    //     }
    //   },
    //   leave(node) {
    //     if (node.type === 'Section') {
    //       sectionIDs.pop();
    //     }
    //   }
    // });
    visit(ast, {
      enter(node) {
        const term = getTerm(node)
        if (!term || terms[term] || !node.id) return
        terms[term] = { ...node, name: term }
      }
    })
    return terms;
  }
)

function getTerm(node) {
  switch (node.type) {
    case 'Algorithm': return node.call.name
    case 'Production':
    case 'OneOfProduction':
        return node.token.name
    case 'Section':
      if (node.definition) return node.id
  }
}

function hasIndex(ast, options) {
  return Object.keys(getTerms(ast)).length !== 0;
}

function printIndex(ast, options) {
  const terms = getTerms(ast);
  const termNames = Object.keys(terms).sort();
  if (termNames.length === 0) {
    return '';
  }

  const items = termNames.map(termName => {
    const node = terms[termName];
    return '<li>' + link(node, options) + '</li>';
  });

  return (
    '<section id="index" secid="index" class="spec-index">' +
      '<h1>' +
        '<span class="spec-secid" title="link to the index">' +
          '<a href="#index">§</a>' +
        '</span>' +
        'Index' +
      '</h1>' +
      '<ol>' + join(items) + '</ol>' +
    '</section>'
  );
}

function join(list, joiner) {
  return list ? list.filter(x => !!x).join(joiner || '') : '';
}

function maybe(value) {
  return value ? value : '';
}

function link(node, options, doHighlight) {
  const href = node.id ? '#' + node.id :
    resolveBiblio(node.id, options) ||
    resolveBiblio(node.name, options) ||
    resolveBiblio(node.title, options)
  const content = escape(node.name);
  if (!href) {
    if (doHighlight) {
      return (
        '<span data-name="' + anchorize(node.name) + '">' +
          content +
        '</span>'
      );
    }
    return content;
  }
  return (
    '<a href="' + href + '"' +
      (doHighlight ? ' data-name="' + anchorize(node.name) + '"' : '') +
      '>' +
      content +
    '</a>'
  );
}

function linkTo(id, content, options) {
  const href = options.biblio[id];
  return (
    `<a href="${href}">` +
      content +
    '</a>'
  );
}

function anchorize(title) {
  return title.replace(/[^A-Za-z0-9\-_@]+/g, '-');
}

function anchorizeDefinition(title) {
  const [name] = title.split(':')
  return anchorize(name)
}

function resolveLinkUrl(url, options) {
  if (url.startsWith('./') || url.startsWith('#')) {
    const hashIdx = url.indexOf('#')
    if (hashIdx !== -1) {
      // Try to resolve GFM references to spec-md references.
      const hashId = url.slice(hashIdx + 1)
      const resolved = resolveBiblio(hashId, options)
      if (resolved) return resolved      
    }
  }
  return url
}

function resolveBiblio(hashId, options) {
  if (!hashId) return
  const ref = options.biblio[hashId]
  if (ref) return ref
  const sectionRef = options.biblio['sec-' + hashId]
  if (sectionRef) return sectionRef
  const callRef = options.biblio[hashId + '()']
  if (callRef) return callRef
  const dotIdx = hashId.lastIndexOf('.')
  if (dotIdx !== -1) {
    const parent = hashId.slice(0, dotIdx)
    const field = hashId.slice(dotIdx + 1)
    const resolved = resolveBiblio(parent, options)
    if (resolved) return resolved + '.' + field
  }
}

const ESCAPE_CODE_REGEX = /[><"'&]/g;
const ESCAPE_REGEX = /\u2010|\u2013|\u2014|\u2018|\u2019|\u201C|\u201D|\u2190|\u2192|\u2194|\u21D0|\u21D2|\u21D4|\u2245|\u2264|\u2265|[><"']|(?:&(?!\S{1,10};))/g;

const ESCAPE_LOOKUP = {
  '&': '&amp;',
  '>': '&gt;',
  '<': '&lt;',
  '"': '&quot;',
  '\'': '&#x27;',
  '\u2010': '&#8208;',
  '\u2013': '&ndash;',
  '\u2014': '&mdash;',
  '\u2018': '&lsquo;',
  '\u2019': '&rsquo;',
  '\u201C': '&ldquo;',
  '\u201D': '&rdquo;',
  '\u2190': '&larr;',
  '\u2192': '&rarr;',
  '\u2194': '&harr;',
  '\u21D0': '&lArr;',
  '\u21D2': '&rArr;',
  '\u21D4': '&hArr;',
  '\u2245': '&cong;',
  '\u2264': '&le;',
  '\u2265': '&ge;',
};

function escaper(match) {
  return ESCAPE_LOOKUP[match];
}

function escapeCode(text) {
  return text.replace(ESCAPE_CODE_REGEX, escaper);
}

function escape(text) {
  return text.replace(ESCAPE_REGEX, escaper);
}

function formatText(text) {
  return escape(text
    .replace(/[ \n\r]+/g, ' ')
    .replace(/<-+>/g, '\u2194')
    .replace(/<-+/g, '\u2190')
    .replace(/-+>/g, '\u2192')
    .replace(/<=+>/g, '\u21D4')
    .replace(/<==+/g, '\u21D0')
    .replace(/=+>/g, '\u21D2')
    .replace(/~=/g, '\u2245')
    .replace(/<=/g, '\u2264')
    .replace(/>=/g, '\u2265')
    .replace(/(\w)--(?=\w)/g, '$1\u2014')
    .replace(/(\w)-(?=\w)/g, '$1\u2010')
    .replace(/(\S\s)-(?=\s\S)/g, '$1\u2013')
    .replace(/(\s)"/g, '$1\u201C')
    .replace(/"(?=\w)/g, '\u201C')
    .replace(/"/g, '\u201D')
    .replace(/(\w)'(?=\w)/g, '$1\u2019')
    .replace(/(\s)'/g, '\u2018')
    .replace(/'(?=\w)/g, '\u2018')
    .replace(/'/g, '\u2019')
  );
}

function execStaticJS(filename) {
  const contents = readStatic(filename);
  return '<script>(function(){' + contents.trim() + '})()</script>\n';
}

function readStatic(filename) {
  return fs.readFileSync(path.join(__dirname, filename), 'utf8');
}

function readPrismCSS() {
  const filename = path.join(
    path.dirname(require.resolve('prismjs')),
    'themes/prism.css'
  );
  return fs.readFileSync(filename, 'utf8');
}

function stableCodeHash(code) {
  const trimmedCode = code.split(/(\n|\r|\r\n)/).map(line => line.trim()).join('\n');
  return crypto.createHash('md5').update(trimmedCode).digest('hex');
}

function stableContentHash(content) {
  const trimmedContent = content.split(/(\n|\r|\r\n)/).map(line => line.trim()).join(' ');
  return crypto.createHash('md5').update(trimmedContent).digest('hex');
}
