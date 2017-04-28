#!/bin/bash

npm run compile

rm index.js
touch index.js
echo 'module.exports = require("./lib/node");' > index.js