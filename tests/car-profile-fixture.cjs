// Evaluate the production, three-free body curves without constructing render geometry.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const source = readFileSync(join(__dirname, '../js/actor-models.js'), 'utf8');
const from = source.indexOf('const BODY_SPECS = {');
const to = source.indexOf('// Section winding used by every car loft');
if (from < 0 || to < from) throw new Error('car profile fixture boundaries changed');
module.exports = vm.runInNewContext(source.slice(from, to) + '\n({ BODY_SPECS, carCrashProfile, carLayout, carDimensions, cargoProfile });');
