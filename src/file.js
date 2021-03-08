const fs = require('fs');

module.exports = readFile

function readFile(filepath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filepath, { encoding: 'utf8' }, (err, result) =>
      err ? reject(err) : resolve(result)
    );
  });
}