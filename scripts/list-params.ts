import { getAllEndpointSlugs } from '../lib/endpoints/registry';

const endpoints = getAllEndpointSlugs();
const result: Record<string, string[]> = {};

endpoints.forEach(ep => {
  if (ep.parametersSchema && Object.keys(ep.parametersSchema).length > 0) {
    result[ep.slug] = Object.keys(ep.parametersSchema);
  } else {
    result[ep.slug] = [];
  }
});

console.log(JSON.stringify(result, null, 2));
