jest.mock('@/lib/crypto', () => ({ decrypt: (value: string) => value }));
jest.mock('@/lib/file-url-downloader', () => ({ parseFileUrlAuthConfig: (value: unknown) => value }));
import { buildBundle, type ExportInput } from '@/lib/profiles/release/export';
import { contentHash } from '@/lib/profiles/release/canonical';
import { parseProfileReleaseBundle } from '@/lib/profiles/release/schema';

const input: ExportInput = {
 profile:{ id:'p1',name:'ocr',displayName:'OCR',note:null,status:'active',role:'STANDARD',workerGroup:'wg',rateLimitPerMin:10,spendingLimit:0,callbackPayload:'WITH_RESULT',fileAuthConfig:JSON.stringify({type:'oauth2_client_credentials',token_url:'https://auth.test/token',client_id:'id',client_secret:'inline',client_secret_ref:'vault#secret'}),callbackAuthConfig:JSON.stringify({type:'bearer',token_secret_ref:'vault#callback'}) },
 endpoints:[{endpointSlug:'extract:invoice',enabled:true,parameters:JSON.stringify({custom:{value:'x'}}),connectionsOverride:null,jobPriority:'MEDIUM',fileUrlAuthConfig:JSON.stringify({type:'bearer',token:'inline'}),fileUrlDefaultChunks:null,allowedFileExtensions:null,referenceExtract:null},{endpointSlug:'analyze:contract',enabled:true,parameters:null,connectionsOverride:null,jobPriority:'MEDIUM',fileUrlAuthConfig:JSON.stringify({type:'bearer',token_secret_ref:'vault#endpoint'}),fileUrlDefaultChunks:null,allowedFileExtensions:null,referenceExtract:null}],
 overrides:[{connectionId:'c1',endpointSlug:'extract:invoice',stepId:'a',promptOverride:'p'},{connectionId:'c2',endpointSlug:'extract:invoice',stepId:'b',modelOverride:'m'},{connectionId:'orphan',endpointSlug:'extract:invoice',stepId:'c',promptOverride:'skip'}], connections:[{id:'c1',slug:'gemini'},{id:'c2',slug:'openai'}],appVersion:'4.12.0',message:'test',exportedBy:'tester'
};
describe('buildBundle',()=>{ const bundle=buildBundle(input);
 it('emits a v1 Profile bundle identity',()=>expect(bundle).toMatchObject({bundleVersion:1,kind:'dugate.profile',profile:{name:'ocr'}}));
 it('strips inline Profile secrets',()=>expect(bundle.profile.fileAuth).not.toHaveProperty('client_secret'));
 it('retains auth structure and Vault reference',()=>expect(bundle.profile.fileAuth).toMatchObject({token_url:'https://auth.test/token',client_id:'id',client_secret_ref:'vault#secret'}));
 it('marks Profile inline secrets but not reference-only callback auth',()=>{expect(bundle.profile.secretRefs.fileAuth.needsInlineSecret).toBe(true);expect(bundle.profile.secretRefs.callbackAuth.needsInlineSecret).toBe(false);});
 // The per-endpoint file-auth override was removed. The bundle keeps the `fileUrlAuth`
 // shape (endpointSchema is strict and requires it) but always emits an empty config, so
 // a stored value is never carried between environments and never needs an inline secret.
 it('never exports endpoint-level auth, even when a legacy column still holds one',()=>{
  for (const endpoint of bundle.endpoints) {
   expect(endpoint.fileUrlAuth).toBeNull();
   expect(endpoint.secretRefs.fileUrlAuth).toEqual({ present:false, type:'none', needsInlineSecret:false });
  }
  expect(JSON.stringify(bundle.endpoints)).not.toContain('inline');
  expect(JSON.stringify(bundle.endpoints)).not.toContain('vault#endpoint');
 });
 it('preserves null pipeline inheritance',()=>expect(bundle.endpoints[0].connections).toBeNull());
 it('maps override connection ids to slugs and excludes orphans',()=>expect(bundle.endpoints[0].overrides.map(x=>x.connectorSlug)).toEqual(['gemini','openai']));
 it('keeps a supplied semantic version in the portable bundle',()=>expect(buildBundle({ ...input, version: '1.2.3' }).meta.version).toBe('1.2.3'));
 it('has an idempotent canonical checksum',()=>expect(bundle.meta.contentHash).toBe(contentHash(bundle)));
 it('roundtrips through strict bundle validation',()=>expect(parseProfileReleaseBundle(JSON.parse(JSON.stringify(bundle))).profile.name).toBe('ocr'));
});
