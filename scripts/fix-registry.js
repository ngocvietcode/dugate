const fs = require('fs');

let content = fs.readFileSync('lib/endpoints/registry.ts', 'utf8');

// The regex will look for:
// clientParams: { ...anything... }, \s* profileOnlyParams: { ...anything... },
const regex = /clientParams:\s*\{([\s\S]*?)\},\s*profileOnlyParams:\s*\{([\s\S]*?)\},/g;

content = content.replace(regex, (match, cParams, pParams) => {
    // For pParams (profile params), they look like: `business_rules: PARAMS.business_rules`
    // We want to transform them to: `business_rules: { ...PARAMS.business_rules, defaultLocked: true }`
    let transformedPParams = pParams.replace(/([a-zA-Z0-9_]+):\s*(PARAMS\.[a-zA-Z0-9_]+)/g, '$1: { ...$2, defaultLocked: true }');
    
    // Some profile params might be just `{}`. If it's effectively empty, we just ignore it.
    let merged = cParams.trim();
    if (merged && transformedPParams.trim()) {
        merged += ', \n        ' + transformedPParams.trim();
    } else if (!merged && transformedPParams.trim()) {
        merged = transformedPParams.trim();
    }
    
    return `parameters: {
        ${merged}
      },`;
});

fs.writeFileSync('lib/endpoints/registry.ts', content);
console.log('Fixed registry!');
